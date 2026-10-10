// Service-role implementation of the engine/service store on PostgreSQL.
// Runs only inside Supabase Edge Functions (Deno). Never ship to browsers.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decryptPassenger, encryptPassenger } from "./engine/passengerCrypto.ts";
import type { ProviderStateStore } from "./engine/providers.ts";
import {
  attemptFromRow,
  attemptToRow,
  bookingFromRow,
  bookingToRow,
  missionFromRow,
  missionToRow,
  passengerSummaryFromRow,
  paymentMethodFromRow,
  paymentMethodToRow,
  reservationFromRow,
  walletTxFromRow,
  walletTxToRow,
} from "./engine/rows.ts";
import type { ServiceStore } from "./engine/service.ts";
import { DuplicateAttemptError, type NewAuditEvent, type NewNotification, UNRESOLVED_ATTEMPT_STATUSES } from "./engine/store.ts";
import type {
  Booking,
  BookingAttempt,
  FlightMission,
  PassengerDetails,
  PassengerSummary,
  PaymentMethod,
  PriceObservation,
  WalletTransaction,
} from "./engine/types.ts";
import { sendNotificationEmail } from "./email.ts";

function check<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** Like check(), but a missing row is an error. */
function one<T>(res: { data: T; error: { message: string; code?: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(res.error.message);
  if (res.data === null || res.data === undefined) throw new Error("Row not found");
  return res.data as NonNullable<T>;
}

export class SupabaseServiceStore implements ServiceStore {
  constructor(
    private db: SupabaseClient,
    private passengerKey: CryptoKey | null,
  ) {}

  async getMission(id: string) {
    const { data, error } = await this.db.from("flight_missions").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? missionFromRow(data) : null;
  }

  async updateMission(id: string, patch: Partial<FlightMission>) {
    const data = one(await this.db.from("flight_missions").update(missionToRow(patch)).eq("id", id).select("*").single());
    return missionFromRow(data);
  }

  async insertMission(m: FlightMission) {
    const row = missionToRow(m);
    const data = one(await this.db.from("flight_missions").insert(row).select("*").single());
    return missionFromRow(data);
  }

  async listDueMissions(nowIso: string, limit: number) {
    const data = one(
      await this.db
        .from("flight_missions")
        .select("*")
        .in("monitoring_status", ["monitoring", "target_reached", "booking_in_progress", "booking_failed", "booked"])
        .not("next_check_at", "is", null)
        .lte("next_check_at", nowIso)
        .order("next_check_at", { ascending: true })
        .limit(limit),
    );
    return (data ?? []).map(missionFromRow);
  }

  async getPaymentMethod(id: string) {
    const { data, error } = await this.db.from("payment_methods").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? paymentMethodFromRow(data) : null;
  }

  async getPassengerDetails(userId: string, ids: string[]): Promise<PassengerDetails[]> {
    if (ids.length === 0) return [];
    if (!this.passengerKey) throw new Error("PASSENGER_DATA_KEY is not configured");
    const data = check(await this.db.from("passenger_profiles").select("id, user_id, encrypted_sensitive_data").eq("user_id", userId).in("id", ids));
    const byId = new Map((data ?? []).map((r: { id: string; encrypted_sensitive_data: string }) => [r.id, r]));
    const out: PassengerDetails[] = [];
    for (const id of ids) {
      const r = byId.get(id);
      if (r) out.push(await decryptPassenger(this.passengerKey, r.encrypted_sensitive_data, `${userId}:${id}`));
    }
    return out;
  }

  async addObservation(o: PriceObservation) {
    const mission = await this.getMission(o.missionId);
    check(
      await this.db.from("flight_price_observations").insert({
        id: o.id,
        mission_id: o.missionId,
        user_id: mission!.userId,
        provider: o.provider,
        itinerary_reference: o.itineraryReference,
        total_price: o.totalPrice,
        currency: o.currency,
        eligible: o.eligible,
        observed_at: o.observedAt,
        offer_metadata: o.offerMetadata,
      }),
    );
  }

  async acquireLock(missionId: string, owner: string, ttlSeconds: number) {
    return check(await this.db.rpc("acquire_booking_lock", { p_mission_id: missionId, p_owner: owner, p_ttl_seconds: ttlSeconds })) === true;
  }

  async releaseLock(missionId: string, owner: string) {
    check(await this.db.rpc("release_booking_lock", { p_mission_id: missionId, p_owner: owner }));
  }

  async findAttemptByKey(key: string) {
    const { data, error } = await this.db.from("booking_attempts").select("*").eq("idempotency_key", key).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? attemptFromRow(data) : null;
  }

  async insertAttempt(a: BookingAttempt) {
    const { data, error } = await this.db.from("booking_attempts").insert(attemptToRow(a)).select("*").single();
    if (error) {
      if (error.code === "23505") throw new DuplicateAttemptError(a.idempotencyKey);
      throw new Error(error.message);
    }
    return attemptFromRow(data);
  }

  async updateAttempt(id: string, patch: Partial<BookingAttempt>) {
    const { updatedAt: _u, ...rest } = patch;
    return attemptFromRow(one(await this.db.from("booking_attempts").update(attemptToRow(rest)).eq("id", id).select("*").single()));
  }

  async listUnresolvedAttempts(missionId: string) {
    const data = check(await this.db.from("booking_attempts").select("*").eq("mission_id", missionId).in("status", [...UNRESOLVED_ATTEMPT_STATUSES]));
    return (data ?? []).map(attemptFromRow);
  }

  async getBookingForMission(missionId: string) {
    const { data, error } = await this.db.from("bookings").select("*").eq("mission_id", missionId).eq("booking_status", "confirmed").maybeSingle();
    if (error) throw new Error(error.message);
    return data ? bookingFromRow(data) : null;
  }

  async insertBooking(b: Booking) {
    return bookingFromRow(one(await this.db.from("bookings").insert(bookingToRow(b)).select("*").single()));
  }

  async updateBooking(id: string, patch: Partial<Booking>) {
    const { updatedAt: _u, ...rest } = patch;
    return bookingFromRow(one(await this.db.from("bookings").update(bookingToRow(rest)).eq("id", id).select("*").single()));
  }

  async getHeldReservation(missionId: string, paymentMethodId: string) {
    const { data, error } = await this.db
      .from("wallet_reservations")
      .select("*")
      .eq("mission_id", missionId)
      .eq("payment_method_id", paymentMethodId)
      .eq("status", "held")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? reservationFromRow(data) : null;
  }

  async captureReservation(reservationId: string, amount: number) {
    check(await this.db.rpc("capture_wallet_reservation", { p_reservation_id: reservationId, p_amount: amount }));
  }

  async releaseReservation(reservationId: string) {
    check(await this.db.from("wallet_reservations").update({ status: "released", updated_at: new Date().toISOString() }).eq("id", reservationId).eq("status", "held"));
  }

  async reserveFunds(paymentMethodId: string, missionId: string, _userId: string, amount: number) {
    check(await this.db.rpc("reserve_wallet_funds", { p_payment_method_id: paymentMethodId, p_mission_id: missionId, p_amount: amount }));
  }

  async notify(n: NewNotification) {
    const row = one(
      await this.db
        .from("notifications")
        .insert({
          user_id: n.userId,
          mission_id: n.missionId,
          kind: n.kind,
          title: n.title,
          body: n.body,
          severity: n.severity,
          requires_action: n.requiresAction,
        })
        .select("id")
        .single(),
    );
    // Email is best-effort and only for important events.
    if (["booking_confirmed", "ticket_issued", "payment_failed", "booking_failed", "authorization_required", "booking_uncertain", "target_reached"].includes(n.kind)) {
      const sent = await sendNotificationEmail(this.db, n).catch(() => false);
      if (sent) await this.db.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", row.id);
    }
  }

  async audit(e: NewAuditEvent) {
    check(await this.db.from("audit_events").insert({ user_id: e.userId, mission_id: e.missionId, kind: e.kind, message: e.message, data: e.data }));
  }

  async listPassengerSummaries(userId: string) {
    const data = check(
      await this.db
        .from("passenger_profiles")
        .select("id, user_id, display_name, passenger_type, nationality, passport_last4, passport_expiry, created_at, updated_at")
        .eq("user_id", userId)
        .order("created_at"),
    );
    return (data ?? []).map(passengerSummaryFromRow);
  }

  async upsertPassenger(s: PassengerSummary, details: PassengerDetails) {
    if (!this.passengerKey) throw new Error("PASSENGER_DATA_KEY is not configured — passenger data cannot be stored securely");
    const encrypted = await encryptPassenger(this.passengerKey, details, `${s.userId}:${s.id}`);
    check(
      await this.db.from("passenger_profiles").upsert({
        id: s.id,
        user_id: s.userId,
        display_name: s.displayName,
        passenger_type: s.passengerType,
        nationality: s.nationality,
        passport_last4: s.passportLast4,
        passport_expiry: s.passportExpiry,
        encrypted_sensitive_data: encrypted,
      }),
    );
  }

  async deletePassenger(userId: string, id: string) {
    check(await this.db.from("passenger_profiles").delete().eq("user_id", userId).eq("id", id));
  }

  async listPaymentMethods(userId: string) {
    const data = check(await this.db.from("payment_methods").select("*").eq("user_id", userId).order("created_at"));
    return (data ?? []).map(paymentMethodFromRow);
  }

  async insertPaymentMethod(pm: PaymentMethod) {
    return paymentMethodFromRow(one(await this.db.from("payment_methods").insert(paymentMethodToRow(pm)).select("*").single()));
  }

  async updatePaymentMethod(id: string, patch: Partial<PaymentMethod>) {
    const row: Record<string, unknown> = {};
    if (patch.authorizationStatus) row.authorization_status = patch.authorizationStatus;
    if (patch.label) row.label = patch.label;
    check(await this.db.from("payment_methods").update(row).eq("id", id));
  }

  async insertWalletTransaction(tx: WalletTransaction) {
    check(await this.db.from("wallet_transactions").insert(walletTxToRow(tx)));
  }

  async listPendingDemoDeposits() {
    const data = check(
      await this.db
        .from("wallet_transactions")
        .select("*, payment_methods!inner(mode)")
        .eq("status", "pending")
        .eq("direction", "deposit")
        .eq("payment_methods.mode", "demo"),
    );
    return (data ?? []).map(walletTxFromRow);
  }

  async setDepositConfirmations(txId: string, confirmations: number) {
    check(await this.db.rpc("confirm_wallet_deposit", { p_transaction_id: txId, p_confirmations: confirmations }));
  }

  async missionsUsingPaymentMethod(paymentMethodId: string) {
    const data = check(await this.db.from("flight_missions").select("*").eq("payment_method_id", paymentMethodId));
    return (data ?? []).map(missionFromRow);
  }

  providerState(): ProviderStateStore {
    return {
      get: async <T,>(key: string) => {
        const { data } = await this.db.from("demo_provider_state").select("value").eq("key", key).maybeSingle();
        return (data?.value as T) ?? null;
      },
      set: async <T,>(key: string, value: T) => {
        check(await this.db.from("demo_provider_state").upsert({ key, value, updated_at: new Date().toISOString() }));
      },
    };
  }
}
