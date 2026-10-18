// NotificationService — channel abstraction. In-app is fully implemented; email
// (Resend) and webhook (Slack/Teams/Telegram-compatible JSON POST) are ready for
// configuration. New channels implement NotificationChannel.

import type { Severity } from "@/domain/types";
import { SEVERITY_LABEL, SEVERITY_RANK } from "@/domain/types";
import { uuid, withUser, type Tx } from "@/server/db";
import { getPreferences, type NotificationPrefs } from "./profile";

export interface AlertMessage {
  alertId: string;
  severity: Severity;
  title: string;
  body: string;
  url: string;
}

export interface DeliveryResult {
  status: "delivered" | "queued" | "not_configured" | "failed" | "skipped";
  detail?: string;
}

export interface NotificationChannel {
  id: "in_app" | "email" | "webhook";
  enabled(prefs: NotificationPrefs, severity: Severity): boolean;
  deliver(msg: AlertMessage, prefs: NotificationPrefs): Promise<DeliveryResult>;
}

const atLeast = (s: Severity, min: Severity) => SEVERITY_RANK[s] >= SEVERITY_RANK[min];

export const inAppChannel: NotificationChannel = {
  id: "in_app",
  enabled: (p) => p.inApp,
  deliver: async () => ({ status: "delivered" }),
};

export const emailChannel: NotificationChannel = {
  id: "email",
  enabled: (p, s) => p.email.enabled && !!p.email.address && atLeast(s, p.email.minSeverity),
  async deliver(msg, prefs) {
    const key = process.env.RESEND_API_KEY;
    if (!key) return { status: "not_configured", detail: "RESEND_API_KEY não configurada; mensagem registrada na fila (outbox)." };
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ from: process.env.NOTIFY_EMAIL_FROM ?? "alerts@atlas.local", to: prefs.email.address, subject: `[Atlas · ${SEVERITY_LABEL[msg.severity]}] ${msg.title}`, text: `${msg.body}\n\n${msg.url}` }),
      });
      return res.ok ? { status: "delivered" } : { status: "failed", detail: `HTTP ${res.status}` };
    } catch (e) {
      return { status: "failed", detail: (e as Error).message };
    }
  },
};

export const webhookChannel: NotificationChannel = {
  id: "webhook",
  enabled: (p, s) => p.webhook.enabled && /^https:\/\//.test(p.webhook.url) && atLeast(s, p.webhook.minSeverity),
  async deliver(msg, prefs) {
    try {
      const res = await fetch(prefs.webhook.url, {
        method: "POST",
        signal: AbortSignal.timeout(5000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `[${SEVERITY_LABEL[msg.severity]}] ${msg.title}\n${msg.body}\n${msg.url}`, severity: msg.severity, alertId: msg.alertId }),
      });
      return res.ok ? { status: "delivered" } : { status: "failed", detail: `HTTP ${res.status}` };
    } catch (e) {
      return { status: "failed", detail: (e as Error).message };
    }
  },
};

export const CHANNELS: NotificationChannel[] = [inAppChannel, emailChannel, webhookChannel];

/** Deliver alerts on every enabled channel. Network calls happen outside DB transactions. */
export async function dispatchAlerts(userId: string, messages: AlertMessage[]): Promise<void> {
  if (messages.length === 0) return;
  const prefs = await withUser(userId, async (tx) => (await getPreferences(tx)).notifications);
  for (const msg of messages) {
    const results: { channel: string; r: DeliveryResult }[] = [];
    for (const ch of CHANNELS) {
      if (!ch.enabled(prefs, msg.severity)) continue;
      results.push({ channel: ch.id, r: await ch.deliver(msg, prefs) });
    }
    await withUser(userId, async (tx) => {
      for (const { channel, r } of results) {
        await tx.query(
          `insert into notifications(id, user_id, alert_id, channel, status, title, body, detail, delivered_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [uuid(), userId, msg.alertId, channel, r.status, msg.title, msg.body, r.detail ?? null, r.status === "delivered" ? new Date().toISOString() : null],
        );
      }
    });
  }
}

export interface NotificationRow {
  id: string;
  alert_id: string | null;
  channel: string;
  status: string;
  title: string;
  body: string;
  detail: string | null;
  created_at: string;
  read_at: string | null;
  severity: Severity | null;
}

export async function listNotifications(tx: Tx, limit = 50): Promise<NotificationRow[]> {
  return tx.query<NotificationRow>(
    `select n.id, n.alert_id, n.channel, n.status, n.title, n.body, n.detail, n.created_at, n.read_at, a.severity
     from notifications n left join alerts a on a.id = n.alert_id order by n.created_at desc limit $1`,
    [limit],
  );
}

export async function unreadCount(tx: Tx): Promise<number> {
  const [r] = await tx.query<{ n: number }>(`select count(*)::int as n from notifications where channel = 'in_app' and read_at is null`);
  return r?.n ?? 0;
}

export async function markAllRead(tx: Tx): Promise<void> {
  await tx.query(`update notifications set read_at = now() where read_at is null and channel = 'in_app'`);
}
