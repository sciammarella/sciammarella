// Supabase backend: reads through RLS, writes through the `api` Edge Function.

import {
  type AuditEvent,
  type ChainNetwork,
  type CycleResult,
  type DemoControls,
  type FlightMission,
  type PassengerSummary,
  type PaymentMethod,
  type StablecoinToken,
} from "@engine/index.ts";
import {
  attemptFromRow,
  auditFromRow,
  bookingFromRow,
  missionFromRow,
  notificationFromRow,
  observationFromRow,
  passengerSummaryFromRow,
  paymentMethodFromRow,
  walletTxFromRow,
} from "@engine/rows.ts";
import type { ActivationIssue, MissionInput, PassengerInput, WalletAvailability } from "@engine/service.ts";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { type Backend, BackendError, type PassengerDocumentReport, type Session, type SystemStatus } from "./types";

const toSession = (u: User): Session => ({ userId: u.id, email: u.email ?? "", fullName: (u.user_metadata?.full_name as string) ?? "" });

export class SupabaseBackend implements Backend {
  readonly kind = "supabase" as const;
  private client: SupabaseClient;
  private listeners = new Set<() => void>();
  private channel: ReturnType<SupabaseClient["channel"]> | null = null;
  private statusCache: Promise<SystemStatus> | null = null;

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey);
    this.client.auth.onAuthStateChange((_e, session) => this.connectRealtime(session?.user?.id ?? null));
    window.setInterval(() => this.emit(), 30000); // safety net if realtime drops
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  private connectRealtime(userId: string | null) {
    if (this.channel) {
      void this.client.removeChannel(this.channel);
      this.channel = null;
    }
    if (!userId) return;
    const ch = this.client.channel(`farebuddy:${userId}`);
    for (const table of ["flight_missions", "notifications", "bookings"]) {
      ch.on("postgres_changes", { event: "*", schema: "public", table, filter: `user_id=eq.${userId}` }, () => this.emit());
    }
    this.channel = ch.subscribe();
  }

  private async call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.client.functions.invoke("api", { body: { action, ...payload } });
    if (error) {
      let message = error.message;
      let details: string[] = [];
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        const body = await ctx.json().catch(() => null);
        if (body?.error) message = body.error;
        if (Array.isArray(body?.details)) details = body.details;
      }
      throw new BackendError(message, details);
    }
    this.emit();
    return data as T;
  }

  private async rows<T>(query: PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, map: (r: never) => T): Promise<T[]> {
    const { data, error } = await query;
    if (error) throw new BackendError(error.message);
    return (data ?? []).map((r) => map(r as never));
  }

  async status(): Promise<SystemStatus> {
    if (!this.statusCache) {
      this.statusCache = this.call<{
        mode: "demo" | "live";
        liveAvailable: boolean;
        checks: SystemStatus["checks"];
        demoSpeed: number;
        stripePublishableKey: string | null;
        passengerEncryption: boolean;
      }>("system.status").then((s) => ({
        backend: "supabase",
        mode: s.mode,
        liveAvailable: s.liveAvailable,
        checks: [{ key: "supabase", label: "Supabase backend", ok: true, detail: "Connected. Monitoring runs server-side via pg_cron.", required: true }, ...s.checks],
        demoSpeed: s.demoSpeed,
        scheduler: "server",
        passengerEncryption: s.passengerEncryption ? "server" : "missing",
        stripePublishableKey: s.stripePublishableKey,
      }));
      this.statusCache.catch(() => (this.statusCache = null));
    }
    return this.statusCache;
  }

  async getSession() {
    const { data } = await this.client.auth.getSession();
    const user = data.session?.user;
    if (user) this.connectRealtime(user.id);
    return user ? toSession(user) : null;
  }
  onAuthChange(cb: (s: Session | null) => void) {
    const { data } = this.client.auth.onAuthStateChange((_e, session) => cb(session?.user ? toSession(session.user) : null));
    return () => data.subscription.unsubscribe();
  }
  async signUp(email: string, password: string, fullName: string) {
    const { data, error } = await this.client.auth.signUp({ email, password, options: { data: { full_name: fullName }, emailRedirectTo: window.location.origin + "/app" } });
    if (error) throw new BackendError(error.message);
    return { session: data.session?.user ? toSession(data.session.user) : null, confirmEmail: !data.session };
  }
  async signIn(email: string, password: string) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw new BackendError(error.message);
    return toSession(data.user);
  }
  async signOut() {
    await this.client.auth.signOut();
  }
  subscribe(cb: () => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  listMissions() {
    return this.rows(this.client.from("flight_missions").select("*").order("created_at", { ascending: false }), missionFromRow);
  }
  async getMission(id: string) {
    const { data, error } = await this.client.from("flight_missions").select("*").eq("id", id).maybeSingle();
    if (error) throw new BackendError(error.message);
    return data ? missionFromRow(data) : null;
  }
  listObservations(missionId: string) {
    return this.rows(this.client.from("flight_price_observations").select("*").eq("mission_id", missionId).order("observed_at").limit(500), observationFromRow);
  }
  listAttempts(missionId: string) {
    return this.rows(this.client.from("booking_attempts").select("*").eq("mission_id", missionId).order("created_at", { ascending: false }), attemptFromRow);
  }
  listAudit(missionId: string | null, limit = 200): Promise<AuditEvent[]> {
    let q = this.client.from("audit_events").select("*").order("created_at", { ascending: false }).limit(limit);
    if (missionId) q = q.eq("mission_id", missionId);
    return this.rows(q, auditFromRow);
  }
  listBookings() {
    return this.rows(this.client.from("bookings").select("*").order("created_at", { ascending: false }), bookingFromRow);
  }
  async getBooking(id: string) {
    const { data, error } = await this.client.from("bookings").select("*").eq("id", id).maybeSingle();
    if (error) throw new BackendError(error.message);
    return data ? bookingFromRow(data) : null;
  }

  saveMission(input: MissionInput) {
    return this.call<{ mission: FlightMission; materialChanges: string[] }>("mission.save", { input });
  }
  async activationCheck(missionId: string) {
    return (await this.call<{ issues: ActivationIssue[] }>("mission.activationCheck", { missionId })).issues;
  }
  async activateMission(missionId: string, autoPurchase: boolean) {
    return (await this.call<{ mission: FlightMission }>("mission.activate", { missionId, autoPurchase, consent: true })).mission;
  }
  async pauseMission(missionId: string) {
    return (await this.call<{ mission: FlightMission }>("mission.pause", { missionId })).mission;
  }
  async resumeMission(missionId: string) {
    return (await this.call<{ mission: FlightMission }>("mission.resume", { missionId })).mission;
  }
  async cancelMission(missionId: string) {
    return (await this.call<{ mission: FlightMission }>("mission.cancel", { missionId })).mission;
  }
  async checkNow(missionId: string) {
    return (await this.call<{ result: CycleResult }>("mission.checkNow", { missionId })).result;
  }
  async approvePurchase(missionId: string) {
    return (await this.call<{ result: CycleResult }>("mission.approve", { missionId })).result;
  }
  async setDemoControls(missionId: string, controls: DemoControls) {
    await this.call("mission.demoControls", { missionId, controls });
  }

  listPassengers(): Promise<PassengerSummary[]> {
    return this.rows(
      this.client.from("passenger_profiles").select("id, user_id, display_name, passenger_type, nationality, passport_last4, passport_expiry, created_at, updated_at").order("created_at"),
      passengerSummaryFromRow,
    );
  }
  async getPassenger(id: string) {
    return (await this.call<{ details: PassengerInput }>("passenger.get", { id })).details;
  }
  async savePassenger(input: PassengerInput) {
    return (await this.call<{ passenger: PassengerSummary }>("passenger.save", { input })).passenger;
  }
  async deletePassenger(id: string) {
    await this.call("passenger.delete", { id });
  }
  async documentChecks(missionId: string) {
    return (await this.call<{ checks: PassengerDocumentReport[] }>("passenger.documentChecks", { missionId })).checks;
  }

  async listPaymentMethods() {
    return (await this.rows(this.client.from("payment_methods").select("*").order("created_at"), paymentMethodFromRow)).filter((p) => p.authorizationStatus !== "revoked");
  }
  async addDemoCard(brand: string) {
    return (await this.call<{ paymentMethod: PaymentMethod }>("payment.addDemoCard", { brand })).paymentMethod;
  }
  async addDemoWallet(token: StablecoinToken, network: ChainNetwork) {
    return (await this.call<{ paymentMethod: PaymentMethod }>("payment.addDemoWallet", { token, network })).paymentMethod;
  }
  async simulateDeposit(paymentMethodId: string, amount: number) {
    await this.call("payment.simulateDeposit", { paymentMethodId, amount });
  }
  walletAvailability(paymentMethodId: string) {
    return this.call<WalletAvailability>("payment.walletAvailability", { paymentMethodId });
  }
  listWalletTransactions(paymentMethodId: string) {
    return this.rows(this.client.from("wallet_transactions").select("*").eq("payment_method_id", paymentMethodId).order("created_at", { ascending: false }), walletTxFromRow);
  }
  async removePaymentMethod(id: string) {
    await this.call("payment.remove", { id });
  }
  stripeSetupIntent() {
    return this.call<{ clientSecret: string; setupIntentId: string }>("payment.stripeSetupIntent");
  }
  async stripeFinalize(setupIntentId: string) {
    return (await this.call<{ paymentMethod: PaymentMethod }>("payment.stripeFinalize", { setupIntentId })).paymentMethod;
  }

  listNotifications() {
    return this.rows(this.client.from("notifications").select("*").order("created_at", { ascending: false }).limit(200), notificationFromRow);
  }
  async markNotificationRead(id: string) {
    await this.client.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    this.emit();
  }
  async markAllNotificationsRead() {
    await this.client.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    this.emit();
  }
}
