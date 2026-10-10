// Browser-only demo runtime. Runs the real booking engine against the demo
// flight provider, persisting to localStorage. Used when Supabase is not
// configured. Monitoring runs while a tab is open (the Supabase deployment
// uses a server-side scheduler instead).

import {
  type AuditEvent,
  type ChainNetwork,
  checkPassengerDocuments,
  DemoCardGateway,
  type DemoControls,
  DemoFlightProvider,
  type EngineDeps,
  evaluateLiveReadiness,
  runDueMissions,
  runMissionCycle,
  type StablecoinToken,
  WalletGateway,
} from "@engine/index.ts";
import { type DemoDatabase, emptyDatabase, MemoryEngineStore } from "@engine/memoryStore.ts";
import { decryptPassenger, encryptPassenger, generatePassengerKey, importPassengerKey } from "@engine/passengerCrypto.ts";
import {
  activateMission,
  activationCheck,
  addDemoCard,
  addDemoWallet,
  cancelMission,
  pauseMission,
  progressDemoDeposits,
  resumeMission,
  saveMission,
  savePassenger,
  ServiceError,
  simulateDeposit,
  walletAvailability,
} from "@engine/service.ts";
import { uuid } from "@engine/util.ts";
import { type Backend, BackendError, type Session, type SystemStatus } from "./types";

const DB_KEY = "farebuddy.demo.db.v1";
const SESSION_KEY = "farebuddy.demo.session";
const DEVICE_KEY = "farebuddy.demo.devicekey";
export const DEMO_SPEED_KEY = "farebuddy.demo.speed";

function loadDb(): DemoDatabase {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return { ...emptyDatabase(), ...JSON.parse(raw) };
  } catch {
    /* corrupted — start fresh */
  }
  return emptyDatabase();
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 120000, hash: "SHA-256" }, key, 256);
  return `${salt}:${btoa(String.fromCharCode(...new Uint8Array(bits)))}`;
}

function wrap<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    if (err instanceof ServiceError) throw new BackendError(err.message, err.details);
    throw err;
  });
}

export class LocalBackend implements Backend {
  readonly kind = "browser" as const;
  private db: DemoDatabase = loadDb();
  private store: MemoryEngineStore;
  private listeners = new Set<() => void>();
  private authListeners = new Set<(s: Session | null) => void>();
  private saveTimer: number | null = null;
  private keyPromise: Promise<CryptoKey>;
  private ticking = false;

  constructor() {
    let raw = localStorage.getItem(DEVICE_KEY);
    if (!raw) {
      raw = generatePassengerKey();
      localStorage.setItem(DEVICE_KEY, raw);
    }
    this.keyPromise = importPassengerKey(raw);
    this.store = this.createStore();

    window.addEventListener("storage", (e) => {
      if (e.key === DB_KEY) {
        this.db = loadDb();
        this.store = this.createStore();
        this.emit();
      }
      if (e.key === SESSION_KEY) this.getSession().then((s) => this.authListeners.forEach((l) => l(s)));
    });

    window.setInterval(() => void this.tick(), 4000);
    setTimeout(() => void this.tick(), 500);
  }

  private createStore() {
    return new MemoryEngineStore(this.db, {
      onChange: () => this.scheduleSave(),
      encryptPassenger: async (s, d) => encryptPassenger(await this.keyPromise, d, `${s.userId}:${s.id}`),
      decryptPassenger: async (r) => decryptPassenger(await this.keyPromise, r.encrypted, `${r.summary.userId}:${r.summary.id}`),
    });
  }

  private scheduleSave() {
    if (this.saveTimer !== null) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      try {
        localStorage.setItem(DB_KEY, JSON.stringify(this.db));
      } catch (err) {
        console.warn("FareBuddy demo: could not persist state", err);
      }
      this.emit();
    }, 50);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  private demoSpeed(): number {
    const v = Number(localStorage.getItem(DEMO_SPEED_KEY) ?? "60");
    return Number.isFinite(v) && v >= 1 ? v : 60;
  }

  private deps(): EngineDeps {
    return {
      store: this.store,
      flights: new DemoFlightProvider(this.store.providerState()),
      cardGateway: new DemoCardGateway(),
      walletGateway: new WalletGateway(this.store, "demo"),
      workerId: "browser",
      demoSpeed: this.demoSpeed(),
    };
  }

  /** Browser scheduler. Only one tab runs it at a time (Web Locks API). */
  private async tick() {
    if (this.ticking) return;
    const run = async () => {
      this.ticking = true;
      try {
        await progressDemoDeposits(this.store, new Date().toISOString());
        await runDueMissions(this.deps(), 10);
      } catch (err) {
        console.warn("FareBuddy demo scheduler", err);
      } finally {
        this.ticking = false;
      }
    };
    if ("locks" in navigator) await navigator.locks.request("farebuddy-demo-scheduler", { ifAvailable: true }, async (lock) => (lock ? run() : undefined));
    else await run();
  }

  private userId(): string {
    const id = localStorage.getItem(SESSION_KEY);
    if (!id || !this.db.users.some((u) => u.id === id)) throw new BackendError("Please sign in again");
    return id;
  }

  private now() {
    return new Date().toISOString();
  }

  async status(): Promise<SystemStatus> {
    const readiness = evaluateLiveReadiness({});
    return {
      backend: "browser",
      mode: "demo",
      liveAvailable: false,
      checks: [
        {
          key: "supabase",
          label: "Supabase backend",
          ok: false,
          detail: "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. Data lives in this browser only; monitoring runs while a FareBuddy tab is open.",
          required: true,
        },
        ...readiness.checks,
      ],
      demoSpeed: this.demoSpeed(),
      scheduler: "browser",
      passengerEncryption: "browser-demo",
      stripePublishableKey: null,
    };
  }

  // ---- auth ---------------------------------------------------------------

  async getSession(): Promise<Session | null> {
    const id = localStorage.getItem(SESSION_KEY);
    const u = this.db.users.find((x) => x.id === id);
    return u ? { userId: u.id, email: u.email, fullName: u.fullName } : null;
  }

  onAuthChange(cb: (s: Session | null) => void) {
    this.authListeners.add(cb);
    return () => this.authListeners.delete(cb);
  }

  async signUp(email: string, password: string, fullName: string) {
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new BackendError("Enter a valid email address");
    if (password.length < 8) throw new BackendError("Password must be at least 8 characters");
    if (this.db.users.some((u) => u.email === normalized)) throw new BackendError("An account with this email already exists in this browser");
    const id = uuid();
    this.db.users.push({ id, email: normalized, fullName: fullName.trim(), passwordHash: await hashPassword(password, uuid()), createdAt: this.now() });
    localStorage.setItem(SESSION_KEY, id);
    this.scheduleSave();
    const session = { userId: id, email: normalized, fullName: fullName.trim() };
    this.authListeners.forEach((l) => l(session));
    return { session, confirmEmail: false };
  }

  async signIn(email: string, password: string) {
    const u = this.db.users.find((x) => x.email === email.trim().toLowerCase());
    if (!u || (await hashPassword(password, u.passwordHash.split(":")[0])) !== u.passwordHash) throw new BackendError("Incorrect email or password");
    localStorage.setItem(SESSION_KEY, u.id);
    const session = { userId: u.id, email: u.email, fullName: u.fullName };
    this.authListeners.forEach((l) => l(session));
    return session;
  }

  async signOut() {
    localStorage.removeItem(SESSION_KEY);
    this.authListeners.forEach((l) => l(null));
  }

  subscribe(cb: () => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ---- reads --------------------------------------------------------------

  async listMissions() {
    const uid = this.userId();
    return this.db.missions.filter((m) => m.userId === uid).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((m) => structuredClone(m));
  }
  async getMission(id: string) {
    const m = this.db.missions.find((x) => x.id === id && x.userId === this.userId());
    return m ? structuredClone(m) : null;
  }
  private ownsMission(id: string) {
    return this.db.missions.some((m) => m.id === id && m.userId === this.userId());
  }
  async listObservations(missionId: string) {
    if (!this.ownsMission(missionId)) return [];
    return this.db.observations.filter((o) => o.missionId === missionId).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  }
  async listAttempts(missionId: string) {
    if (!this.ownsMission(missionId)) return [];
    return this.db.attempts.filter((a) => a.missionId === missionId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async listAudit(missionId: string | null, limit = 200): Promise<AuditEvent[]> {
    const uid = this.userId();
    return this.db.audit.filter((e) => e.userId === uid && (missionId === null || e.missionId === missionId)).slice(0, limit);
  }
  async listBookings() {
    const uid = this.userId();
    return this.db.bookings.filter((b) => b.userId === uid).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async getBooking(id: string) {
    return this.db.bookings.find((b) => b.id === id && b.userId === this.userId()) ?? null;
  }

  // ---- missions -----------------------------------------------------------

  saveMission(input: Parameters<Backend["saveMission"]>[0]) {
    return wrap(() => saveMission(this.store, this.userId(), "demo", input, this.now()));
  }
  async activationCheck(missionId: string) {
    const m = await this.getMission(missionId);
    if (!m) throw new BackendError("Mission not found");
    return activationCheck(this.store, this.userId(), m, this.now());
  }
  activateMission(missionId: string, autoPurchase: boolean) {
    return wrap(async () => {
      const m = await activateMission(this.store, this.userId(), missionId, { autoPurchase, consent: true }, this.now());
      setTimeout(() => void this.tick(), 50);
      return m;
    });
  }
  pauseMission(id: string) {
    return wrap(() => pauseMission(this.store, this.userId(), id));
  }
  resumeMission(id: string) {
    return wrap(() => resumeMission(this.store, this.userId(), id, this.now()));
  }
  cancelMission(id: string) {
    return wrap(() => cancelMission(this.store, this.userId(), id, this.now()));
  }
  async checkNow(id: string) {
    if (!this.ownsMission(id)) throw new BackendError("Mission not found");
    return runMissionCycle(id, this.deps());
  }
  async approvePurchase(id: string) {
    if (!this.ownsMission(id)) throw new BackendError("Mission not found");
    await this.store.audit({ userId: this.userId(), missionId: id, kind: "manual_approval", message: "User approved purchase of the current best eligible fare", data: {} });
    return runMissionCycle(id, this.deps(), { manualApproval: true });
  }
  async setDemoControls(id: string, controls: DemoControls) {
    const m = await this.getMission(id);
    if (!m) throw new BackendError("Mission not found");
    await this.store.updateMission(id, { demoControls: { ...m.demoControls, ...controls } });
    await this.store.audit({ userId: m.userId, missionId: id, kind: "demo_control", message: `DEMO control set: ${JSON.stringify(controls)}`, data: {} });
  }

  // ---- passengers ---------------------------------------------------------

  async listPassengers() {
    return this.store.listPassengerSummaries(this.userId());
  }
  async getPassenger(id: string) {
    const uid = this.userId();
    const [details] = await this.store.getPassengerDetails(uid, [id]);
    const summary = (await this.store.listPassengerSummaries(uid)).find((s) => s.id === id);
    if (!details || !summary) throw new BackendError("Passenger not found");
    return { ...details, passengerType: summary.passengerType };
  }
  savePassenger(input: Parameters<Backend["savePassenger"]>[0]) {
    return wrap(() => savePassenger(this.store, this.userId(), input, this.now()));
  }
  async deletePassenger(id: string) {
    const uid = this.userId();
    const active = this.db.missions.some(
      (m) => m.userId === uid && m.passengerProfileIds.includes(id) && ["monitoring", "target_reached", "booking_in_progress"].includes(m.monitoringStatus),
    );
    if (active) throw new BackendError("This passenger is used by an active mission. Pause or cancel it first.");
    await this.store.deletePassenger(uid, id);
  }
  async documentChecks(missionId: string) {
    const m = await this.getMission(missionId);
    if (!m) return [];
    const details = await this.store.getPassengerDetails(this.userId(), m.passengerProfileIds);
    return details.map((d) => ({ passengerId: d.id, name: d.fullLegalName, checks: checkPassengerDocuments(d, m) }));
  }

  // ---- payments -----------------------------------------------------------

  async listPaymentMethods() {
    return (await this.store.listPaymentMethods(this.userId())).filter((p) => p.authorizationStatus !== "revoked");
  }
  addDemoCard(brand: string) {
    return wrap(() => addDemoCard(this.store, this.userId(), brand, this.now()));
  }
  addDemoWallet(token: StablecoinToken, network: ChainNetwork) {
    return wrap(() => addDemoWallet(this.store, this.userId(), token, network, this.now()));
  }
  async simulateDeposit(paymentMethodId: string, amount: number) {
    await wrap(() => simulateDeposit(this.store, this.userId(), paymentMethodId, amount, this.now()));
  }
  async walletAvailability(paymentMethodId: string) {
    const pm = await this.store.getPaymentMethod(paymentMethodId);
    if (!pm || pm.userId !== this.userId()) throw new BackendError("Wallet not found");
    return walletAvailability(this.store, pm);
  }
  async listWalletTransactions(paymentMethodId: string) {
    const uid = this.userId();
    return this.db.walletTransactions.filter((t) => t.paymentMethodId === paymentMethodId && t.userId === uid).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async removePaymentMethod(id: string) {
    const uid = this.userId();
    const pm = await this.store.getPaymentMethod(id);
    if (!pm || pm.userId !== uid) throw new BackendError("Payment method not found");
    const missions = await this.store.missionsUsingPaymentMethod(id);
    if (missions.some((m) => ["monitoring", "target_reached", "booking_in_progress"].includes(m.monitoringStatus)))
      throw new BackendError("This payment method backs an active mission. Pause or cancel it first.");
    await this.store.updatePaymentMethod(id, { authorizationStatus: "revoked" });
    await this.store.audit({ userId: uid, missionId: null, kind: "payment_method_revoked", message: `${pm.label} revoked`, data: {} });
  }
  async stripeSetupIntent(): Promise<{ clientSecret: string; setupIntentId: string }> {
    throw new BackendError("Real card tokenization requires the Supabase backend with live Stripe credentials.");
  }
  async stripeFinalize(): Promise<never> {
    throw new BackendError("Real card tokenization requires the Supabase backend with live Stripe credentials.");
  }

  // ---- notifications ------------------------------------------------------

  async listNotifications() {
    const uid = this.userId();
    return this.db.notifications.filter((n) => n.userId === uid).slice(0, 200);
  }
  async markNotificationRead(id: string) {
    const n = this.db.notifications.find((x) => x.id === id && x.userId === this.userId());
    if (n && !n.readAt) {
      n.readAt = this.now();
      this.scheduleSave();
    }
  }
  async markAllNotificationsRead() {
    const uid = this.userId();
    for (const n of this.db.notifications) if (n.userId === uid && !n.readAt) n.readAt = this.now();
    this.scheduleSave();
  }
}
