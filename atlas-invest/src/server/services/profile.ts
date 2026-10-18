// UserProfileService — investment profile and user preferences.

import { z } from "zod";
import { DEFAULT_THRESHOLDS, type Thresholds } from "@/domain/alerts";
import { deriveProfile } from "@/domain/profile";
import { ALL_ASSET_CLASSES, type AssetClass, type DerivedProfile, type ProfileAnswers } from "@/domain/types";
import type { Tx } from "@/server/db";
import { audit } from "./audit";

const classEnum = z.enum(ALL_ASSET_CLASSES as [AssetClass, ...AssetClass[]]);
const experience = z.enum(["none", "basic", "intermediate", "advanced"]);

export const ProfileAnswersSchema = z.object({
  residenceCountry: z.enum(["BR", "US", "OTHER"]),
  baseCurrency: z.enum(["BRL", "USD"]),
  amount: z.number().positive().max(1e11),
  objective: z.enum(["preservation", "income", "growth", "high_growth"]),
  targetReturn: z.number().min(0.01).max(5),
  horizon: z.enum(["lt1", "1to3", "3to5", "gt5"]),
  lossTolerance: z.enum(["low", "moderate", "high", "very_high"]),
  liquidityNeed: z.enum(["daily", "monthly", "annual", "none"]),
  markets: z.array(z.enum(["BR", "US"])).min(1),
  allowedClasses: z.array(classEnum),
  excludedClasses: z.array(classEnum),
  experience,
  cryptoExperience: experience,
  qualifiedInvestor: z.boolean().optional(),
});

export interface StoredProfile {
  answers: ProfileAnswers;
  derived: DerivedProfile;
  updatedAt: string;
}

export async function getProfile(tx: Tx): Promise<StoredProfile | null> {
  const [r] = await tx.query<{ answers: ProfileAnswers; derived: DerivedProfile; updated_at: string }>(`select answers, derived, updated_at from investment_profiles`);
  return r ? { answers: r.answers, derived: r.derived, updatedAt: r.updated_at } : null;
}

export async function saveProfile(tx: Tx, userId: string, input: unknown): Promise<StoredProfile> {
  const answers = ProfileAnswersSchema.parse(input) as ProfileAnswers;
  const derived = deriveProfile(answers);
  await tx.query(
    `insert into investment_profiles(user_id, answers, derived, base_currency, methodology_version) values ($1,$2,$3,$4,$5)
     on conflict (user_id) do update set answers=excluded.answers, derived=excluded.derived, base_currency=excluded.base_currency,
       methodology_version=excluded.methodology_version, updated_at=now()`,
    [userId, JSON.stringify(answers), JSON.stringify(derived), answers.baseCurrency, derived.methodologyVersion],
  );
  await audit(tx, userId, "user", "profile.saved", "investment_profile", userId, { level: derived.level, targetReturn: answers.targetReturn });
  return { answers, derived, updatedAt: new Date().toISOString() };
}

export interface NotificationPrefs {
  inApp: boolean;
  email: { enabled: boolean; address: string; minSeverity: "info" | "attention" | "critical" };
  webhook: { enabled: boolean; url: string; minSeverity: "info" | "attention" | "critical" };
  dailyDigest: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  inApp: true,
  email: { enabled: false, address: "", minSeverity: "critical" },
  webhook: { enabled: false, url: "", minSeverity: "attention" },
  dailyDigest: false,
};

export const ThresholdsSchema = z.object({
  priceMoveEquity: z.number().min(0.005).max(0.5),
  priceMoveCrypto: z.number().min(0.01).max(0.9),
  priceMoveFixed: z.number().min(0.001).max(0.3),
  stablecoinDepeg: z.number().min(0.001).max(0.2),
  driftPp: z.number().min(0.01).max(0.5),
  maxSingleWeight: z.number().min(0.05).max(1),
  fxMove: z.number().min(0.005).max(0.5),
  rateMovePp: z.number().min(0.0005).max(0.05),
  volRatio: z.number().min(1.1).max(5),
  minWeightForPriceAlert: z.number().min(0).max(0.5),
  cooldownHours: z.number().min(1).max(24 * 30),
  minSeverity: z.enum(["info", "attention", "critical"]),
});

export const NotificationPrefsSchema = z.object({
  inApp: z.boolean(),
  email: z.object({ enabled: z.boolean(), address: z.string().max(200), minSeverity: z.enum(["info", "attention", "critical"]) }),
  webhook: z.object({ enabled: z.boolean(), url: z.string().max(500), minSeverity: z.enum(["info", "attention", "critical"]) }),
  dailyDigest: z.boolean(),
});

export async function getPreferences(tx: Tx): Promise<{ notifications: NotificationPrefs; thresholds: Thresholds }> {
  const [r] = await tx.query<{ notifications: Partial<NotificationPrefs>; thresholds: Partial<Thresholds> }>(`select notifications, thresholds from user_preferences`);
  return {
    notifications: { ...DEFAULT_NOTIFICATION_PREFS, ...(r?.notifications ?? {}) },
    thresholds: { ...DEFAULT_THRESHOLDS, ...(r?.thresholds ?? {}) },
  };
}

export async function savePreferences(tx: Tx, userId: string, input: { notifications?: unknown; thresholds?: unknown }): Promise<void> {
  const current = await getPreferences(tx);
  const notifications = input.notifications ? NotificationPrefsSchema.parse(input.notifications) : current.notifications;
  const thresholds = input.thresholds ? ThresholdsSchema.parse(input.thresholds) : current.thresholds;
  if (notifications.webhook.enabled && notifications.webhook.url && !/^https:\/\//.test(notifications.webhook.url)) {
    throw new Error("O webhook precisa usar HTTPS.");
  }
  await tx.query(
    `insert into user_preferences(user_id, notifications, thresholds) values ($1,$2,$3)
     on conflict (user_id) do update set notifications=excluded.notifications, thresholds=excluded.thresholds, updated_at=now()`,
    [userId, JSON.stringify(notifications), JSON.stringify(thresholds)],
  );
  await audit(tx, userId, "user", "preferences.saved", "user_preferences", userId, {});
}
