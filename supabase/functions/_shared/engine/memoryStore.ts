// In-memory EngineStore. Used by tests and, persisted to localStorage, by the
// browser-only demo runtime. Not used in production.

import type { ProviderStateStore } from "./providers.ts";
import type { ServiceStore } from "./service.ts";
import { DuplicateAttemptError, type EngineStore, type NewAuditEvent, type NewNotification, UNRESOLVED_ATTEMPT_STATUSES } from "./store.ts";
import type {
  AppNotification,
  AuditEvent,
  Booking,
  BookingAttempt,
  FlightMission,
  PassengerDetails,
  PassengerSummary,
  PaymentMethod,
  PriceObservation,
  WalletReservation,
  WalletTransaction,
} from "./types.ts";
import { uuid } from "./util.ts";

export interface DemoUser {
  id: string;
  email: string;
  fullName: string;
  passwordHash: string;
  createdAt: string;
}

export interface StoredPassenger {
  summary: PassengerSummary;
  /** AES-GCM ciphertext of PassengerDetails (base64). */
  encrypted: string;
}

export interface DemoDatabase {
  version: 1;
  users: DemoUser[];
  missions: FlightMission[];
  observations: PriceObservation[];
  attempts: BookingAttempt[];
  bookings: Booking[];
  paymentMethods: PaymentMethod[];
  walletTransactions: WalletTransaction[];
  reservations: WalletReservation[];
  passengers: StoredPassenger[];
  notifications: AppNotification[];
  audit: AuditEvent[];
  locks: Record<string, { owner: string; expiresAt: string }>;
  providerState: Record<string, unknown>;
}

export function emptyDatabase(): DemoDatabase {
  return {
    version: 1,
    users: [],
    missions: [],
    observations: [],
    attempts: [],
    bookings: [],
    paymentMethods: [],
    walletTransactions: [],
    reservations: [],
    passengers: [],
    notifications: [],
    audit: [],
    locks: {},
    providerState: {},
  };
}

export interface MemoryStoreOptions {
  decryptPassenger: (record: StoredPassenger) => Promise<PassengerDetails>;
  encryptPassenger?: (summary: PassengerSummary, details: PassengerDetails) => Promise<string>;
  onChange?: () => void;
  clock?: () => Date;
}

export class MemoryEngineStore implements EngineStore, ServiceStore {
  constructor(
    public db: DemoDatabase,
    private opts: MemoryStoreOptions,
  ) {}

  private now() {
    return (this.opts.clock ?? (() => new Date()))().toISOString();
  }
  private changed() {
    this.opts.onChange?.();
  }

  async getMission(id: string) {
    const m = this.db.missions.find((x) => x.id === id);
    return m ? structuredClone(m) : null;
  }

  async updateMission(id: string, patch: Partial<FlightMission>) {
    const i = this.db.missions.findIndex((x) => x.id === id);
    if (i < 0) throw new Error(`Mission ${id} not found`);
    this.db.missions[i] = { ...this.db.missions[i], ...structuredClone(patch), updatedAt: this.now() };
    this.changed();
    return structuredClone(this.db.missions[i]);
  }

  async listDueMissions(nowIso: string, limit: number) {
    return this.db.missions
      .filter(
        (m) =>
          ["monitoring", "target_reached", "booking_in_progress", "booking_failed", "booked"].includes(m.monitoringStatus) &&
          m.nextCheckAt !== null &&
          m.nextCheckAt <= nowIso,
      )
      .sort((a, b) => (a.nextCheckAt ?? "").localeCompare(b.nextCheckAt ?? ""))
      .slice(0, limit)
      .map((m) => structuredClone(m));
  }

  async getPaymentMethod(id: string) {
    const pm = this.db.paymentMethods.find((x) => x.id === id);
    if (!pm) return null;
    return { ...structuredClone(pm), confirmedBalance: pm.paymentType === "stablecoin_wallet" ? this.walletBalance(pm.id) : null };
  }

  walletBalance(paymentMethodId: string): number {
    let total = 0;
    for (const tx of this.db.walletTransactions) {
      if (tx.paymentMethodId !== paymentMethodId || tx.status !== "confirmed") continue;
      total += tx.direction === "spend" ? -tx.amount : tx.amount;
    }
    return Math.round(total * 100) / 100;
  }

  /** Confirmed balance minus funds held for missions. */
  availableBalance(paymentMethodId: string): number {
    const held = this.db.reservations
      .filter((r) => r.paymentMethodId === paymentMethodId && r.status === "held")
      .reduce((s, r) => s + r.amount, 0);
    return Math.round((this.walletBalance(paymentMethodId) - held) * 100) / 100;
  }

  async getPassengerDetails(userId: string, ids: string[]) {
    const records = ids
      .map((id) => this.db.passengers.find((p) => p.summary.id === id && p.summary.userId === userId))
      .filter((p): p is StoredPassenger => !!p);
    return Promise.all(records.map((r) => this.opts.decryptPassenger(r)));
  }

  async addObservation(o: PriceObservation) {
    this.db.observations.push(structuredClone(o));
    this.changed();
  }

  async acquireLock(missionId: string, owner: string, ttlSeconds: number) {
    const current = this.db.locks[missionId];
    if (current && current.expiresAt > this.now() && current.owner !== owner) return false;
    this.db.locks[missionId] = { owner, expiresAt: new Date(Date.parse(this.now()) + ttlSeconds * 1000).toISOString() };
    this.changed();
    return true;
  }

  async releaseLock(missionId: string, owner: string) {
    if (this.db.locks[missionId]?.owner === owner) {
      delete this.db.locks[missionId];
      this.changed();
    }
  }

  async findAttemptByKey(key: string) {
    const a = this.db.attempts.find((x) => x.idempotencyKey === key);
    return a ? structuredClone(a) : null;
  }

  async insertAttempt(a: BookingAttempt) {
    if (this.db.attempts.some((x) => x.idempotencyKey === a.idempotencyKey)) throw new DuplicateAttemptError(a.idempotencyKey);
    this.db.attempts.push(structuredClone(a));
    this.changed();
    return structuredClone(a);
  }

  async updateAttempt(id: string, patch: Partial<BookingAttempt>) {
    const i = this.db.attempts.findIndex((x) => x.id === id);
    if (i < 0) throw new Error(`Attempt ${id} not found`);
    this.db.attempts[i] = { ...this.db.attempts[i], ...structuredClone(patch) };
    this.changed();
    return structuredClone(this.db.attempts[i]);
  }

  async listUnresolvedAttempts(missionId: string) {
    return this.db.attempts
      .filter((a) => a.missionId === missionId && (UNRESOLVED_ATTEMPT_STATUSES as readonly string[]).includes(a.status))
      .map((a) => structuredClone(a));
  }

  async getBookingForMission(missionId: string) {
    const b = this.db.bookings.find((x) => x.missionId === missionId && x.bookingStatus === "confirmed");
    return b ? structuredClone(b) : null;
  }

  async insertBooking(b: Booking) {
    if (this.db.bookings.some((x) => x.missionId === b.missionId && x.bookingStatus === "confirmed"))
      throw new Error("Mission already has a confirmed booking");
    this.db.bookings.push(structuredClone(b));
    this.changed();
    return structuredClone(b);
  }

  async updateBooking(id: string, patch: Partial<Booking>) {
    const i = this.db.bookings.findIndex((x) => x.id === id);
    this.db.bookings[i] = { ...this.db.bookings[i], ...structuredClone(patch) };
    this.changed();
    return structuredClone(this.db.bookings[i]);
  }

  async getHeldReservation(missionId: string, paymentMethodId: string) {
    const r = this.db.reservations.find((x) => x.missionId === missionId && x.paymentMethodId === paymentMethodId && x.status === "held");
    return r ? structuredClone(r) : null;
  }

  async captureReservation(reservationId: string, amount: number) {
    const r = this.db.reservations.find((x) => x.id === reservationId);
    if (!r || r.status !== "held") throw new Error("Reservation is not held");
    if (amount > r.amount + 1e-9) throw new Error("Capture exceeds reserved amount");
    const pm = this.db.paymentMethods.find((p) => p.id === r.paymentMethodId)!;
    r.status = "captured";
    r.capturedAmount = amount;
    r.updatedAt = this.now();
    this.db.walletTransactions.push({
      id: uuid(),
      paymentMethodId: r.paymentMethodId,
      userId: r.userId,
      direction: "spend",
      amount,
      token: pm.wallet!.token,
      network: pm.wallet!.network,
      txHash: `ledger:${r.id}`,
      confirmations: pm.wallet!.requiredConfirmations,
      requiredConfirmations: pm.wallet!.requiredConfirmations,
      status: "confirmed",
      createdAt: this.now(),
    });
    this.changed();
  }

  async releaseReservation(reservationId: string) {
    const r = this.db.reservations.find((x) => x.id === reservationId);
    if (r && r.status === "held") {
      r.status = "released";
      r.updatedAt = this.now();
      this.changed();
    }
  }

  async notify(n: NewNotification) {
    this.db.notifications.unshift({ ...n, id: uuid(), createdAt: this.now(), readAt: null });
    this.changed();
  }

  async audit(e: NewAuditEvent) {
    this.db.audit.unshift({ ...e, id: uuid(), createdAt: this.now() });
    if (this.db.audit.length > 3000) this.db.audit.length = 3000;
    this.changed();
  }

  // ---- ServiceStore -------------------------------------------------------

  async insertMission(m: FlightMission) {
    this.db.missions.push(structuredClone(m));
    this.changed();
    return structuredClone(m);
  }

  async listPassengerSummaries(userId: string) {
    return this.db.passengers.filter((p) => p.summary.userId === userId).map((p) => structuredClone(p.summary));
  }

  async upsertPassenger(summary: PassengerSummary, details: PassengerDetails) {
    if (!this.opts.encryptPassenger) throw new Error("Passenger encryption is not configured");
    const encrypted = await this.opts.encryptPassenger(summary, details);
    const i = this.db.passengers.findIndex((p) => p.summary.id === summary.id);
    if (i >= 0) this.db.passengers[i] = { summary: structuredClone(summary), encrypted };
    else this.db.passengers.push({ summary: structuredClone(summary), encrypted });
    this.changed();
  }

  async deletePassenger(userId: string, id: string) {
    this.db.passengers = this.db.passengers.filter((p) => !(p.summary.id === id && p.summary.userId === userId));
    this.changed();
  }

  async listPaymentMethods(userId: string) {
    const list = this.db.paymentMethods.filter((p) => p.userId === userId).map((p) => p.id);
    return Promise.all(list.map(async (id) => (await this.getPaymentMethod(id))!));
  }

  async insertPaymentMethod(pm: PaymentMethod) {
    this.db.paymentMethods.push(structuredClone(pm));
    this.changed();
    return structuredClone(pm);
  }

  async updatePaymentMethod(id: string, patch: Partial<PaymentMethod>) {
    const i = this.db.paymentMethods.findIndex((p) => p.id === id);
    if (i >= 0) this.db.paymentMethods[i] = { ...this.db.paymentMethods[i], ...structuredClone(patch) };
    this.changed();
  }

  async reserveFunds(paymentMethodId: string, missionId: string, userId: string, amount: number) {
    const existing = this.db.reservations.find((r) => r.missionId === missionId && r.status === "held");
    if (existing) existing.status = "released";
    const available = this.availableBalance(paymentMethodId);
    if (available + 1e-9 < amount) {
      if (existing) existing.status = "held";
      throw new Error(`Insufficient available balance: ${available.toFixed(2)} available, ${amount.toFixed(2)} required`);
    }
    this.db.reservations.push({
      id: uuid(),
      paymentMethodId,
      missionId,
      userId,
      amount,
      status: "held",
      capturedAmount: 0,
      createdAt: this.now(),
      updatedAt: this.now(),
    });
    this.changed();
  }

  async insertWalletTransaction(tx: WalletTransaction) {
    this.db.walletTransactions.push(structuredClone(tx));
    this.changed();
  }

  async listPendingDemoDeposits() {
    return this.db.walletTransactions.filter((t) => t.status === "pending" && t.direction === "deposit").map((t) => structuredClone(t));
  }

  async setDepositConfirmations(txId: string, confirmations: number) {
    const tx = this.db.walletTransactions.find((t) => t.id === txId);
    if (!tx || tx.status !== "pending") return;
    tx.confirmations = confirmations;
    if (confirmations >= tx.requiredConfirmations) tx.status = "confirmed";
    this.changed();
  }

  async missionsUsingPaymentMethod(paymentMethodId: string) {
    return this.db.missions.filter((m) => m.paymentMethodId === paymentMethodId).map((m) => structuredClone(m));
  }

  providerState(): ProviderStateStore {
    return {
      get: async <T,>(key: string) => (this.db.providerState[key] as T) ?? null,
      set: async <T,>(key: string, value: T) => {
        this.db.providerState[key] = structuredClone(value);
        this.changed();
      },
    };
  }
}
