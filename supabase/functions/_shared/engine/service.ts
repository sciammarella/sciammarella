// Mission, passenger and payment-method operations shared by the browser demo
// runtime and the `api` Edge Function. All authorization rules live here.

import { buildAuthorization, checkAuthorization, materialChanges } from "./authorization.ts";
import { checkPassengerDocuments, missionTitle, placeRef, validateMissionDraft, withResolvedAirports } from "./mission.ts";
import { demoDepositAddress, tokenNetwork } from "./payments.ts";
import { spendingCeiling } from "./selection.ts";
import type { EngineStore } from "./store.ts";
import type {
  ChainNetwork,
  Currency,
  FlightMission,
  FlightPreferences,
  PassengerDetails,
  PassengerSummary,
  PaymentMethod,
  RuntimeMode,
  StablecoinToken,
  WalletTransaction,
} from "./types.ts";
import { hashString, uuid } from "./util.ts";

export class ServiceError extends Error {
  constructor(
    message: string,
    public details: string[] = [],
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export interface ServiceStore extends EngineStore {
  insertMission(m: FlightMission): Promise<FlightMission>;
  listPassengerSummaries(userId: string): Promise<PassengerSummary[]>;
  upsertPassenger(summary: PassengerSummary, details: PassengerDetails): Promise<void>;
  deletePassenger(userId: string, id: string): Promise<void>;
  listPaymentMethods(userId: string): Promise<PaymentMethod[]>;
  insertPaymentMethod(pm: PaymentMethod): Promise<PaymentMethod>;
  updatePaymentMethod(id: string, patch: Partial<PaymentMethod>): Promise<void>;
  /** Atomically earmark funds; throws if the available balance is insufficient. */
  reserveFunds(paymentMethodId: string, missionId: string, userId: string, amount: number): Promise<void>;
  insertWalletTransaction(tx: WalletTransaction): Promise<void>;
  listPendingDemoDeposits(): Promise<WalletTransaction[]>;
  /** Update confirmations; credits the balance exactly once when the threshold is reached. */
  setDepositConfirmations(txId: string, confirmations: number): Promise<void>;
  missionsUsingPaymentMethod(paymentMethodId: string): Promise<FlightMission[]>;
}

export interface MissionInput {
  id?: string;
  originCode: string;
  destinationCode: string;
  departureDate: string;
  returnDate: string | null;
  passengerProfileIds: string[];
  preferences: FlightPreferences;
  targetPrice: number;
  maximumAuthorizedAmount: number;
  priceTolerance: number;
  currency: Currency;
  paymentMethodId: string | null;
  monitoringIntervalMinutes: number;
}

const EDITABLE: FlightMission["monitoringStatus"][] = ["draft", "monitoring", "target_reached", "action_required", "paused", "booking_failed"];

export async function saveMission(
  store: ServiceStore,
  userId: string,
  mode: RuntimeMode,
  input: MissionInput,
  now: string,
): Promise<{ mission: FlightMission; materialChanges: string[] }> {
  const existing = input.id ? await store.getMission(input.id) : null;
  if (input.id && (!existing || existing.userId !== userId)) throw new ServiceError("Mission not found");
  if (existing && !EDITABLE.includes(existing.monitoringStatus)) throw new ServiceError(`A ${existing.monitoringStatus.replace("_", " ")} mission cannot be edited`);

  const origin = placeRef(input.originCode);
  const destination = placeRef(input.destinationCode);
  const preferences = withResolvedAirports({ origin, destination }, {
    ...input.preferences,
    flexibleDays: Math.max(0, Math.min(3, Math.round(input.preferences.flexibleDays))),
    maxStops: Math.max(0, Math.min(3, Math.round(input.preferences.maxStops))),
  });
  const base: FlightMission = existing ?? {
    id: uuid(),
    userId,
    mode,
    title: "",
    origin,
    destination,
    departureDate: "",
    returnDate: null,
    passengerProfileIds: [],
    preferences,
    targetPrice: 0,
    maximumAuthorizedAmount: 0,
    priceTolerance: 0,
    currency: "USD",
    paymentMethodId: null,
    monitoringStatus: "draft",
    monitoringIntervalMinutes: 60,
    purchaseAuthorization: null,
    bestOffer: null,
    lowestObserved: null,
    lastCheckedAt: null,
    nextCheckAt: null,
    checkCount: 0,
    lastError: null,
    statusReason: null,
    notificationState: {},
    demoControls: null,
    createdAt: now,
    updatedAt: now,
  };

  const next: FlightMission = {
    ...base,
    title: missionTitle({ origin, destination }),
    origin,
    destination,
    departureDate: input.departureDate,
    returnDate: preferences.tripType === "round_trip" ? input.returnDate : null,
    passengerProfileIds: input.passengerProfileIds,
    preferences,
    targetPrice: input.targetPrice,
    maximumAuthorizedAmount: input.maximumAuthorizedAmount,
    priceTolerance: Math.max(0, input.priceTolerance || 0),
    currency: input.currency,
    paymentMethodId: input.paymentMethodId,
    monitoringIntervalMinutes: Math.max(15, input.monitoringIntervalMinutes),
  };

  const errors = validateMissionDraft(next, now.slice(0, 10));
  if (errors.length) throw new ServiceError("Please fix the highlighted fields", errors.map((e) => e.message));

  let changes: string[] = [];
  if (!existing) {
    await store.insertMission(next);
    await store.audit({ userId, missionId: next.id, kind: "mission_created", message: `Draft mission ${next.title} created`, data: {} });
    return { mission: next, materialChanges: [] };
  }

  if (existing.purchaseAuthorization && !existing.purchaseAuthorization.revokedAt) {
    changes = materialChanges(existing, next);
    if (changes.length) {
      next.purchaseAuthorization = { ...existing.purchaseAuthorization, revokedAt: now, autoPurchase: false };
      if (["monitoring", "target_reached", "booking_failed"].includes(existing.monitoringStatus)) {
        next.monitoringStatus = "action_required";
        next.statusReason = "Purchase conditions changed — confirm the new authorization to resume";
      }
      // Wallet funds stay reserved until the user re-authorizes or cancels.
      await store.audit({
        userId,
        missionId: next.id,
        kind: "authorization_revoked",
        message: `Authorization revoked after material changes: ${changes.join(", ")}`,
        data: { changes },
      });
    }
  }
  const { id: _id, userId: _u, createdAt: _c, ...patch } = next;
  const saved = await store.updateMission(existing.id, patch);
  await store.audit({ userId, missionId: next.id, kind: "mission_updated", message: "Mission conditions updated", data: { materialChanges: changes } });
  return { mission: saved, materialChanges: changes };
}

export interface ActivationIssue {
  level: "error" | "warning";
  message: string;
}

/** Everything that must be true before automatic monitoring/purchase can start. */
export async function activationCheck(store: ServiceStore, userId: string, mission: FlightMission, now: string): Promise<ActivationIssue[]> {
  const issues: ActivationIssue[] = [];
  for (const e of validateMissionDraft(mission, now.slice(0, 10))) issues.push({ level: "error", message: e.message });
  const pax = mission.preferences.passengers;
  const required = pax.adults + pax.children + pax.infants;
  if (mission.passengerProfileIds.length !== required)
    issues.push({ level: "error", message: `Select ${required} passenger profile${required > 1 ? "s" : ""} (currently ${mission.passengerProfileIds.length})` });
  const summaries = (await store.listPassengerSummaries(userId)).filter((s) => mission.passengerProfileIds.includes(s.id));
  const typeCount = (t: string) => summaries.filter((s) => s.passengerType === t).length;
  if (summaries.length === required && (typeCount("adult") !== pax.adults || typeCount("child") !== pax.children || typeCount("infant") !== pax.infants))
    issues.push({ level: "error", message: "Selected passenger types (adult/child/infant) do not match the passenger counts" });
  const details = await store.getPassengerDetails(userId, mission.passengerProfileIds);
  for (const d of details)
    for (const c of checkPassengerDocuments(d, mission)) if (c.level === "error") issues.push({ level: "error", message: `${d.fullLegalName}: ${c.message}` });

  if (!mission.paymentMethodId) issues.push({ level: "error", message: "Choose a payment method" });
  else {
    const pm = await store.getPaymentMethod(mission.paymentMethodId);
    if (!pm || pm.userId !== userId) issues.push({ level: "error", message: "Payment method not found" });
    else {
      if (pm.mode !== mission.mode) issues.push({ level: "error", message: `A ${pm.mode} payment method cannot pay for a ${mission.mode} mission` });
      if (pm.authorizationStatus !== "active") issues.push({ level: "error", message: "Payment method is not authorized yet" });
      if (pm.paymentType === "stablecoin_wallet") {
        if (mission.currency !== "USD") issues.push({ level: "error", message: "Stablecoin wallets can only fund USD missions" });
        const ceiling = spendingCeiling(mission);
        const held = await store.getHeldReservation(mission.id, pm.id);
        const available = (await walletAvailability(store, pm)).available + (held?.amount ?? 0);
        if (available < ceiling)
          issues.push({ level: "error", message: `Wallet has ${available.toFixed(2)} USD available; ${ceiling.toFixed(2)} USD must be reserved for this mission` });
      }
    }
  }
  return issues;
}

export async function activateMission(
  store: ServiceStore,
  userId: string,
  missionId: string,
  opts: { autoPurchase: boolean; consent: boolean },
  now: string,
): Promise<FlightMission> {
  const mission = await store.getMission(missionId);
  if (!mission || mission.userId !== userId) throw new ServiceError("Mission not found");
  if (!["draft", "action_required", "paused", "booking_failed", "monitoring", "target_reached"].includes(mission.monitoringStatus))
    throw new ServiceError(`A ${mission.monitoringStatus.replace("_", " ")} mission cannot be activated`);
  if (!opts.consent) throw new ServiceError("Explicit consent is required to authorize purchases");
  const issues = (await activationCheck(store, userId, mission, now)).filter((i) => i.level === "error");
  if (issues.length) throw new ServiceError("This mission cannot be activated yet", issues.map((i) => i.message));

  const pm = (await store.getPaymentMethod(mission.paymentMethodId!))!;
  if (pm.paymentType === "stablecoin_wallet") {
    await store.reserveFunds(pm.id, mission.id, userId, spendingCeiling({ ...mission, purchaseAuthorization: null }));
  }
  const names = (await store.listPassengerSummaries(userId)).filter((s) => mission.passengerProfileIds.includes(s.id)).map((s) => s.displayName);
  const authorization = buildAuthorization(mission, pm, names, opts.autoPurchase, now);
  const updated = await store.updateMission(mission.id, {
    purchaseAuthorization: authorization,
    monitoringStatus: "monitoring",
    statusReason: null,
    nextCheckAt: now,
    lastError: null,
    notificationState: {},
  });
  await store.audit({
    userId,
    missionId,
    kind: "authorization_granted",
    message: `Authorization v${authorization.version} granted: ${opts.autoPurchase ? "automatic purchase" : "approval required"} up to ${mission.maximumAuthorizedAmount} ${mission.currency}`,
    data: { version: authorization.version, autoPurchase: opts.autoPurchase, constraintsHash: authorization.constraintsHash, summary: authorization.summary },
  });
  return updated;
}

export async function pauseMission(store: ServiceStore, userId: string, missionId: string): Promise<FlightMission> {
  const m = await owned(store, userId, missionId);
  if (!["monitoring", "target_reached", "action_required", "booking_failed"].includes(m.monitoringStatus))
    throw new ServiceError(`A ${m.monitoringStatus.replace("_", " ")} mission cannot be paused`);
  const updated = await store.updateMission(m.id, { monitoringStatus: "paused", nextCheckAt: null, statusReason: "Paused by you" });
  await store.audit({ userId, missionId, kind: "status_change", message: `${m.monitoringStatus} → paused (by user)`, data: {} });
  return updated;
}

export async function resumeMission(store: ServiceStore, userId: string, missionId: string, now: string): Promise<FlightMission> {
  const m = await owned(store, userId, missionId);
  if (m.monitoringStatus !== "paused") throw new ServiceError("Only paused missions can be resumed");
  const auth = checkAuthorization(m);
  if (!auth.valid) {
    return store.updateMission(m.id, { monitoringStatus: "action_required", statusReason: `${auth.reason} — confirm the authorization to resume` });
  }
  const updated = await store.updateMission(m.id, { monitoringStatus: "monitoring", nextCheckAt: now, statusReason: null });
  await store.audit({ userId, missionId, kind: "status_change", message: "paused → monitoring (by user)", data: {} });
  return updated;
}

export async function cancelMission(store: ServiceStore, userId: string, missionId: string, now: string): Promise<FlightMission> {
  const m = await owned(store, userId, missionId);
  if (["booked", "booking_in_progress", "cancelled"].includes(m.monitoringStatus))
    throw new ServiceError(`A ${m.monitoringStatus.replace("_", " ")} mission cannot be cancelled here`);
  if (m.paymentMethodId) {
    const r = await store.getHeldReservation(m.id, m.paymentMethodId);
    if (r) await store.releaseReservation(r.id);
  }
  const updated = await store.updateMission(m.id, {
    monitoringStatus: "cancelled",
    nextCheckAt: null,
    statusReason: "Cancelled by you",
    purchaseAuthorization: m.purchaseAuthorization ? { ...m.purchaseAuthorization, revokedAt: now, autoPurchase: false } : null,
  });
  await store.audit({ userId, missionId, kind: "authorization_revoked", message: "Mission cancelled; authorization revoked and reserved funds released", data: {} });
  return updated;
}

async function owned(store: ServiceStore, userId: string, missionId: string) {
  const m = await store.getMission(missionId);
  if (!m || m.userId !== userId) throw new ServiceError("Mission not found");
  return m;
}

// ---------------------------------------------------------------------------
// Passengers

export interface PassengerInput extends Omit<PassengerDetails, "id"> {
  id?: string;
  passengerType: PassengerSummary["passengerType"];
}

export function validatePassenger(p: PassengerInput, today: string): string[] {
  const errors: string[] = [];
  if (!p.givenName.trim() || !p.familyName.trim()) errors.push("Given and family names are required (as printed on the passport)");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.dateOfBirth) || p.dateOfBirth >= today) errors.push("A valid date of birth is required");
  if (p.passportNumber && !/^[A-Z0-9]{5,12}$/i.test(p.passportNumber)) errors.push("Passport number should be 5–12 letters or digits");
  if (p.passportNumber && !p.passportExpiry) errors.push("Passport expiration date is required");
  if (p.passportExpiry && p.passportExpiry <= today) errors.push("Passport is expired");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) errors.push("A valid email is required");
  if (!/^\+?[0-9 ()-]{7,20}$/.test(p.phone)) errors.push("A valid phone number in international format is required");
  return errors;
}

export async function savePassenger(store: ServiceStore, userId: string, input: PassengerInput, now: string): Promise<PassengerSummary> {
  const errors = validatePassenger(input, now.slice(0, 10));
  if (errors.length) throw new ServiceError("Please fix the passenger details", errors);
  const existing = input.id ? (await store.listPassengerSummaries(userId)).find((s) => s.id === input.id) : undefined;
  if (input.id && !existing) throw new ServiceError("Passenger not found");
  const id = existing?.id ?? uuid();
  const { passengerType, id: _ignored, ...rest } = input;
  const details: PassengerDetails = {
    ...rest,
    id,
    passportNumber: rest.passportNumber.toUpperCase().replace(/\s/g, ""),
    fullLegalName: `${rest.givenName.trim()} ${rest.familyName.trim()}`,
  };
  const summary: PassengerSummary = {
    id,
    userId,
    displayName: details.fullLegalName,
    passengerType,
    nationality: details.nationality,
    passportLast4: details.passportNumber ? details.passportNumber.slice(-4) : null,
    passportExpiry: details.passportExpiry || null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await store.upsertPassenger(summary, details);
  // Note: never put passport data in audit logs.
  await store.audit({ userId, missionId: null, kind: existing ? "passenger_updated" : "passenger_created", message: `Passenger profile ${summary.displayName} saved`, data: {} });
  return summary;
}

// ---------------------------------------------------------------------------
// Payment methods

export const DEMO_CARDS = [
  { brand: "visa", last4: "4242", label: "Visa" },
  { brand: "mastercard", last4: "4444", label: "Mastercard" },
  { brand: "amex", last4: "0005", label: "American Express" },
] as const;

export async function addDemoCard(store: ServiceStore, userId: string, brand: string, now: string): Promise<PaymentMethod> {
  const card = DEMO_CARDS.find((c) => c.brand === brand) ?? DEMO_CARDS[0];
  const pm: PaymentMethod = {
    id: uuid(),
    userId,
    mode: "demo",
    paymentType: "card",
    label: `Demo ${card.label} •••• ${card.last4}`,
    provider: "demo-card",
    providerReference: `demo_cus_${hashString(userId).slice(0, 8)}`,
    tokenOrWalletReference: `demo_pm_${hashString(userId + now).slice(0, 10)}`,
    currency: "USD",
    authorizationStatus: "active",
    card: { brand: card.brand, last4: card.last4, expMonth: 12, expYear: 2030 },
    wallet: null,
    confirmedBalance: null,
    createdAt: now,
  };
  await store.insertPaymentMethod(pm);
  await store.audit({ userId, missionId: null, kind: "payment_method_added", message: `${pm.label} added (simulated tokenization)`, data: {} });
  return pm;
}

export async function addDemoWallet(store: ServiceStore, userId: string, token: StablecoinToken, network: ChainNetwork, now: string): Promise<PaymentMethod> {
  const tn = tokenNetwork(token, network);
  if (!tn) throw new ServiceError(`${token} on ${network} is not supported`);
  const pm: PaymentMethod = {
    id: uuid(),
    userId,
    mode: "demo",
    paymentType: "stablecoin_wallet",
    label: `Demo ${token} wallet · ${tn.networkLabel}`,
    provider: "demo-wallet",
    providerReference: null,
    tokenOrWalletReference: `demo_wallet_${hashString(userId + token + network + now).slice(0, 10)}`,
    currency: "USD",
    authorizationStatus: "active",
    card: null,
    wallet: {
      token,
      network,
      depositAddress: demoDepositAddress(userId + token + network + now),
      tokenContract: tn.contract,
      requiredConfirmations: tn.requiredConfirmations,
    },
    confirmedBalance: 0,
    createdAt: now,
  };
  await store.insertPaymentMethod(pm);
  await store.audit({ userId, missionId: null, kind: "payment_method_added", message: `${pm.label} created (simulated custody)`, data: {} });
  return pm;
}

export async function simulateDeposit(store: ServiceStore, userId: string, paymentMethodId: string, amount: number, now: string): Promise<WalletTransaction> {
  const pm = await store.getPaymentMethod(paymentMethodId);
  if (!pm || pm.userId !== userId || pm.paymentType !== "stablecoin_wallet") throw new ServiceError("Wallet not found");
  if (pm.mode !== "demo") throw new ServiceError("Simulated deposits are only available in demo mode");
  if (!(amount > 0) || amount > 50000) throw new ServiceError("Deposit amount must be between 0 and 50,000");
  const tx: WalletTransaction = {
    id: uuid(),
    paymentMethodId,
    userId,
    direction: "deposit",
    amount: Math.round(amount * 100) / 100,
    token: pm.wallet!.token,
    network: pm.wallet!.network,
    txHash: `demo_tx_${hashString(paymentMethodId + now + amount)}`,
    confirmations: 0,
    requiredConfirmations: pm.wallet!.requiredConfirmations,
    status: "pending",
    createdAt: now,
  };
  await store.insertWalletTransaction(tx);
  await store.audit({ userId, missionId: null, kind: "wallet_deposit_detected", message: `Simulated deposit of ${tx.amount} ${tx.token} detected (0/${tx.requiredConfirmations} confirmations)`, data: {} });
  return tx;
}

/** Demo chains "mine" one confirmation every 2 seconds. */
export async function progressDemoDeposits(store: ServiceStore, now: string): Promise<number> {
  let confirmed = 0;
  for (const tx of await store.listPendingDemoDeposits()) {
    const elapsed = (Date.parse(now) - Date.parse(tx.createdAt)) / 1000;
    const confirmations = Math.min(tx.requiredConfirmations, Math.max(0, Math.floor(elapsed / 2)));
    if (confirmations !== tx.confirmations) {
      await store.setDepositConfirmations(tx.id, confirmations);
      if (confirmations >= tx.requiredConfirmations) {
        confirmed++;
        await store.notify({
          userId: tx.userId,
          missionId: null,
          kind: "info",
          title: "Deposit confirmed",
          body: `DEMO: ${tx.amount} ${tx.token} is now available in your wallet.`,
          severity: "success",
          requiresAction: false,
        });
      }
    }
  }
  return confirmed;
}

export interface WalletAvailability {
  confirmed: number;
  held: number;
  available: number;
  pending: number;
}

export async function walletAvailability(store: ServiceStore, pm: PaymentMethod): Promise<WalletAvailability> {
  const confirmed = pm.confirmedBalance ?? 0;
  const missions = await store.missionsUsingPaymentMethod(pm.id);
  let held = 0;
  for (const m of missions) {
    const r = await store.getHeldReservation(m.id, pm.id);
    if (r) held += r.amount;
  }
  const pendingTx = (await store.listPendingDemoDeposits()).filter((t) => t.paymentMethodId === pm.id);
  const pending = pendingTx.reduce((s, t) => s + t.amount, 0);
  return { confirmed, held: round2(held), available: round2(confirmed - held), pending: round2(pending) };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
