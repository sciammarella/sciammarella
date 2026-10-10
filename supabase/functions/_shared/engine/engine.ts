// Autonomous booking engine.
//
// One "cycle" = load mission → reconcile uncertain attempts → search → filter →
// rank → (if eligible and authorized) lock → revalidate → hold payment →
// submit order → confirm → capture → record booking → notify.
//
// Safety rules enforced here:
//  * Never spend above the authorized maximum (+ tolerance, default 0).
//  * Never book an itinerary that violates a mandatory constraint.
//  * Never claim a booking the provider did not confirm.
//  * Never resubmit an order whose outcome is unknown — reconcile first.
//  * One booking process per mission (lock) and one order per idempotency key.

import { checkAuthorization } from "./authorization.ts";
import { DemoFlightProvider } from "./demoFlightProvider.ts";
import type { FlightProvider, OrderLookup, OrderResult, PaymentGateway } from "./providers.ts";
import { ProviderTimeoutError } from "./providers.ts";
import { buildSearchRequest, describeOffer, evaluateOffer, rankOffers, spendingCeiling } from "./selection.ts";
import { DuplicateAttemptError, type EngineStore } from "./store.ts";
import type {
  Booking,
  BookingAttempt,
  DemoOutcome,
  EvaluatedOffer,
  FlightMission,
  MissionStatus,
  OfferSnapshot,
  PaymentMethod,
} from "./types.ts";
import { errorMessage, uuid } from "./util.ts";

export interface EngineDeps {
  store: EngineStore;
  flights: FlightProvider;
  cardGateway: PaymentGateway;
  walletGateway: PaymentGateway;
  clock?: () => Date;
  workerId?: string;
  /** Demo only: divide monitoring intervals by this factor. */
  demoSpeed?: number;
  /** Notify when the best eligible price is within this fraction above target. */
  approachingThreshold?: number;
  /** Give up automatic reconciliation and ask a human after this many tries. */
  maxReconcileAttempts?: number;
}

export type CycleAction =
  | "skipped"
  | "checked"
  | "target_reached"
  | "booked"
  | "booking_failed"
  | "uncertain"
  | "reconciling"
  | "expired"
  | "action_required"
  | "locked"
  | "error";

export interface CycleResult {
  missionId: string;
  action: CycleAction;
  message: string;
  bestPrice?: number;
}

const MONITORABLE: MissionStatus[] = ["monitoring", "target_reached", "booking_in_progress", "booking_failed"];
const LOCK_TTL_SECONDS = 180;

export async function runMissionCycle(
  missionId: string,
  deps: EngineDeps,
  opts: { manualApproval?: boolean } = {},
): Promise<CycleResult> {
  const { store } = deps;
  const clock = deps.clock ?? (() => new Date());
  const now = () => clock().toISOString();

  let mission = await store.getMission(missionId);
  if (!mission) return { missionId, action: "skipped", message: "Mission not found" };

  if (mission.monitoringStatus === "booked") return refreshTicketing(mission, deps);
  if (!MONITORABLE.includes(mission.monitoringStatus))
    return { missionId, action: "skipped", message: `Mission is ${mission.monitoringStatus}` };

  if (mission.mode !== deps.flights.mode) {
    await setStatus(deps, mission, "action_required", `This ${mission.mode} mission cannot run on the ${deps.flights.mode} provider`);
    return { missionId, action: "action_required", message: "Mode mismatch" };
  }

  // Expiry: stop once the departure date is no longer bookable.
  const today = now().slice(0, 10);
  if (mission.departureDate <= today) return expireMission(mission, deps);

  // 1. Reconcile any attempt whose outcome is not yet known. Never search/buy on top of it.
  const open = await store.listUnresolvedAttempts(mission.id);
  if (open.length > 0) {
    for (const attempt of open) {
      const outcome = await reconcileAttempt(mission, attempt, deps);
      if (outcome === "confirmed") return { missionId, action: "booked", message: "Booking confirmed during reconciliation" };
      if (outcome === "unresolved") {
        await store.updateMission(mission.id, { nextCheckAt: nextCheck(mission, deps, 2) });
        return { missionId, action: "reconciling", message: "Waiting for the booking provider to confirm the outcome" };
      }
    }
    mission = (await store.getMission(missionId))!;
    if (!MONITORABLE.includes(mission.monitoringStatus)) return { missionId, action: "skipped", message: `Mission is ${mission.monitoringStatus}` };
  }

  // 2. Search.
  const request = buildSearchRequest(mission);
  if (deps.flights.mode === "demo") {
    request.demo = {
      seed: mission.id,
      tick: mission.checkCount,
      flashSaleAmount: mission.demoControls?.flashSaleAmount ?? null,
      // The simulated flash-sale price is the full payable total (bags included).
      isEligible: (o) => {
        const e = evaluateOffer(o, mission!);
        return e.eligible && e.requiredBagCost === 0;
      },
    };
  }

  let evaluated: EvaluatedOffer[];
  try {
    const offers = await deps.flights.search(request);
    evaluated = offers.map((o) => evaluateOffer(o, mission!));
  } catch (err) {
    await store.updateMission(mission.id, { lastError: `Search failed: ${errorMessage(err)}`, nextCheckAt: nextCheck(mission, deps) });
    await store.audit({ userId: mission.userId, missionId: mission.id, kind: "search_failed", message: errorMessage(err), data: {} });
    return { missionId, action: "error", message: `Search failed: ${errorMessage(err)}` };
  }

  const ranked = rankOffers(evaluated, mission);
  const best = ranked[0];
  const cheapestAny = [...evaluated].sort((a, b) => a.payableTotal - b.payableTotal)[0];
  const observed = best ?? cheapestAny;
  const observedAt = now();

  if (observed) {
    await store.addObservation({
      id: uuid(),
      missionId: mission.id,
      provider: deps.flights.name,
      itineraryReference: observed.offer.id,
      totalPrice: observed.payableTotal,
      currency: mission.currency,
      observedAt,
      eligible: !!best,
      offerMetadata: {
        carriers: [...new Set(observed.offer.slices.flatMap((s) => s.segments.map((x) => x.marketingCarrier)))],
        stops: observed.offer.slices.map((s) => s.segments.length - 1),
        durationMinutes: observed.offer.slices.map((s) => s.durationMinutes),
        summary: describeOffer(observed.offer),
        offersSeen: evaluated.length,
        eligibleCount: ranked.length,
      },
    });
  }

  const lowest = best ? Math.min(best.payableTotal, mission.lowestObserved ?? Infinity) : mission.lowestObserved;
  const notificationState = { ...mission.notificationState };
  const patch: Partial<FlightMission> = {
    checkCount: mission.checkCount + 1,
    lastCheckedAt: observedAt,
    nextCheckAt: nextCheck(mission, deps),
    lastError: null,
    bestOffer: best ? snapshot(best, deps.flights.name, observedAt) : null,
    lowestObserved: lowest === Infinity ? null : lowest,
    demoControls: mission.demoControls ? { ...mission.demoControls, flashSaleAmount: null } : null,
  };

  await store.audit({
    userId: mission.userId,
    missionId: mission.id,
    kind: "price_check",
    message: best
      ? `Checked ${evaluated.length} offers, ${ranked.length} eligible. Best eligible ${fmt(best.payableTotal, mission.currency)}.`
      : `Checked ${evaluated.length} offers, none meet all of your conditions.`,
    data: { offersSeen: evaluated.length, eligible: ranked.length, best: best?.payableTotal ?? null },
  });

  if (!best) {
    if (mission.monitoringStatus === "target_reached" || mission.monitoringStatus === "booking_failed") patch.monitoringStatus = "monitoring";
    await store.updateMission(mission.id, { ...patch, notificationState: { approaching: false, reached: false } });
    return { missionId, action: "checked", message: "No eligible offers right now" };
  }

  // Approaching / reached notifications fire on threshold crossings only.
  const threshold = mission.targetPrice * (1 + (deps.approachingThreshold ?? 0.1));
  const reachable = best.withinTarget && best.withinAuthorization;
  if (!reachable && best.payableTotal <= threshold && !notificationState.approaching) {
    notificationState.approaching = true;
    await store.notify({
      userId: mission.userId,
      missionId: mission.id,
      kind: "approaching_target",
      title: "Price is approaching your target",
      body: `${mission.title}: best eligible fare is ${fmt(best.payableTotal, mission.currency)} (target ${fmt(mission.targetPrice, mission.currency)}).`,
      severity: "info",
      requiresAction: false,
    });
  }
  if (best.payableTotal > threshold) notificationState.approaching = false;
  if (!reachable) notificationState.reached = false;

  if (!reachable) {
    if (mission.monitoringStatus !== "monitoring") patch.monitoringStatus = "monitoring";
    await store.updateMission(mission.id, { ...patch, notificationState });
    return { missionId, action: "checked", message: `Best eligible ${fmt(best.payableTotal, mission.currency)}`, bestPrice: best.payableTotal };
  }

  // 3. Target reached.
  if (!notificationState.reached) {
    notificationState.reached = true;
    await store.notify({
      userId: mission.userId,
      missionId: mission.id,
      kind: "target_reached",
      title: "Target price reached",
      body: `${mission.title}: ${fmt(best.payableTotal, mission.currency)} — ${describeOffer(best.offer)}`,
      severity: "success",
      requiresAction: false,
    });
  }
  mission = await store.updateMission(mission.id, { ...patch, notificationState });

  const auth = checkAuthorization(mission);
  if (!auth.valid) {
    await setStatus(deps, mission, "action_required", auth.reason);
    await store.notify({
      userId: mission.userId,
      missionId: mission.id,
      kind: "authorization_required",
      title: "Your authorization is needed",
      body: `${mission.title}: an eligible fare is available but ${auth.reason.toLowerCase()}. Review and re-authorize to let FareBuddy book.`,
      severity: "warning",
      requiresAction: true,
    });
    return { missionId, action: "action_required", message: auth.reason, bestPrice: best.payableTotal };
  }

  if (!mission.purchaseAuthorization!.autoPurchase && !opts.manualApproval) {
    if (mission.monitoringStatus !== "target_reached") {
      await setStatus(deps, mission, "target_reached", "Automatic purchase is off — waiting for your approval");
      await store.notify({
        userId: mission.userId,
        missionId: mission.id,
        kind: "target_reached",
        title: "Approve to book",
        body: `${mission.title}: automatic purchase is off. Approve to book ${fmt(best.payableTotal, mission.currency)} now.`,
        severity: "warning",
        requiresAction: true,
      });
    }
    return { missionId, action: "target_reached", message: "Waiting for user approval", bestPrice: best.payableTotal };
  }

  // 4. Purchase.
  return purchase(mission, best, deps, request);
}

async function purchase(
  initial: FlightMission,
  best: EvaluatedOffer,
  deps: EngineDeps,
  request: ReturnType<typeof buildSearchRequest>,
): Promise<CycleResult> {
  const { store } = deps;
  const clock = deps.clock ?? (() => new Date());
  const now = () => clock().toISOString();
  const lockOwner = `${deps.workerId ?? "worker"}:${uuid()}`;
  const missionId = initial.id;

  if (!(await store.acquireLock(missionId, lockOwner, LOCK_TTL_SECONDS)))
    return { missionId, action: "locked", message: "Another process is already booking this mission" };

  try {
    // Re-read inside the lock: state may have changed since the search.
    const mission = await store.getMission(missionId);
    if (!mission || !["monitoring", "target_reached", "booking_failed"].includes(mission.monitoringStatus))
      return { missionId, action: "skipped", message: `Mission is ${mission?.monitoringStatus ?? "missing"}` };
    if (await store.getBookingForMission(missionId)) {
      await setStatus(deps, mission, "booked", null);
      return { missionId, action: "skipped", message: "Mission already has a confirmed booking" };
    }
    if ((await store.listUnresolvedAttempts(missionId)).length > 0)
      return { missionId, action: "reconciling", message: "An earlier attempt is still being reconciled" };

    const authorization = mission.purchaseAuthorization!;
    const idempotencyKey = `fb_${mission.id}_${best.offer.id}_v${authorization.version}`;
    const previous = await store.findAttemptByKey(idempotencyKey);
    if (previous) {
      // This exact offer was already tried under this authorization. Do not repeat it.
      await setStatus(deps, mission, "monitoring", `Offer already attempted (${previous.status}); waiting for a new eligible fare`);
      return { missionId, action: "checked", message: "Offer was already attempted" };
    }

    // Demo controls are one-shot.
    const demoOutcome: DemoOutcome | undefined = mission.mode === "demo" ? (mission.demoControls?.nextOutcome ?? undefined) : undefined;
    if (demoOutcome) await store.updateMission(mission.id, { demoControls: { ...mission.demoControls, nextOutcome: undefined } });

    await setStatus(deps, mission, "booking_in_progress", "Revalidating price and availability");
    await store.notify({
      userId: mission.userId,
      missionId,
      kind: "purchase_started",
      title: "Purchase attempt started",
      body: `${mission.title}: booking ${fmt(best.payableTotal, mission.currency)} — ${describeOffer(best.offer)}`,
      severity: "info",
      requiresAction: false,
    });

    let attempt: BookingAttempt;
    try {
      attempt = await store.insertAttempt({
        id: uuid(),
        missionId,
        userId: mission.userId,
        mode: mission.mode,
        offerId: best.offer.id,
        providerReference: null,
        paymentReference: null,
        idempotencyKey,
        status: "revalidating",
        amount: best.payableTotal,
        currency: mission.currency,
        failureReason: null,
        reconcileAttempts: 0,
        offerSnapshot: best.offer,
        createdAt: now(),
        updatedAt: now(),
      });
    } catch (err) {
      if (err instanceof DuplicateAttemptError) return { missionId, action: "locked", message: "Duplicate attempt prevented" };
      throw err;
    }
    const audit = (kind: string, message: string, data: Record<string, unknown> = {}) =>
      store.audit({ userId: mission.userId, missionId, kind, message, data: { attemptId: attempt.id, ...data } });
    await audit("purchase_decision", `Selected ${describeOffer(best.offer)} at ${fmt(best.payableTotal, mission.currency)}`, {
      offerId: best.offer.id,
      payable: best.payableTotal,
      ceiling: spendingCeiling(mission),
      target: mission.targetPrice,
    });

    // 5. Revalidate availability and the final payable price.
    let fresh = await deps.flights.revalidate(best.offer, request);
    if (deps.flights instanceof DemoFlightProvider) fresh = deps.flights.applyRevalidationOutcome(fresh, demoOutcome);
    if (!fresh) {
      await store.updateAttempt(attempt.id, { status: "aborted", failureReason: "Offer no longer available", updatedAt: now() });
      await audit("offer_unavailable", "Offer disappeared during revalidation");
      await store.notify({
        userId: mission.userId,
        missionId,
        kind: "offer_unavailable",
        title: "Fare disappeared before purchase",
        body: `${mission.title}: the selected fare was no longer available. No payment was taken. Monitoring continues.`,
        severity: "warning",
        requiresAction: false,
      });
      await setStatus(deps, mission, "monitoring", "Selected fare disappeared — monitoring continues");
      return { missionId, action: "checked", message: "Offer no longer available" };
    }
    const recheck = evaluateOffer(fresh, mission);
    if (!recheck.eligible || !recheck.withinAuthorization) {
      const reason = !recheck.eligible
        ? `Offer changed and no longer meets your conditions: ${recheck.violations[0]}`
        : `Final price ${fmt(recheck.payableTotal, mission.currency)} is above your authorized maximum ${fmt(spendingCeiling(mission), mission.currency)}`;
      await store.updateAttempt(attempt.id, { status: "aborted", failureReason: reason, updatedAt: now() });
      await audit("price_changed", reason, { payable: recheck.payableTotal });
      await store.notify({
        userId: mission.userId,
        missionId,
        kind: "price_changed",
        title: "Purchase stopped: price changed",
        body: `${mission.title}: ${reason}. Nothing was purchased. Monitoring continues.`,
        severity: "warning",
        requiresAction: false,
      });
      await setStatus(deps, mission, "monitoring", reason);
      return { missionId, action: "checked", message: reason };
    }
    const amount = recheck.payableTotal;
    attempt = await store.updateAttempt(attempt.id, { amount, offerSnapshot: fresh, updatedAt: now() });

    // 6. Verify payment authorization and hold funds.
    const paymentMethod = mission.paymentMethodId ? await store.getPaymentMethod(mission.paymentMethodId) : null;
    if (!paymentMethod || paymentMethod.authorizationStatus !== "active" || paymentMethod.mode !== mission.mode) {
      const reason = "Payment method is missing or no longer authorized";
      await store.updateAttempt(attempt.id, { status: "aborted", failureReason: reason, updatedAt: now() });
      await failForAction(deps, mission, "payment_failed", reason);
      return { missionId, action: "action_required", message: reason };
    }
    const gateway = gatewayFor(paymentMethod, deps);
    const hold = await gateway.authorize({ paymentMethod, missionId, amount, currency: mission.currency, idempotencyKey, demoOutcome });
    if (hold.status !== "authorized") {
      await store.updateAttempt(attempt.id, { status: "failed", failureReason: hold.reason, updatedAt: now() });
      await audit("payment_failed", hold.reason);
      await failForAction(deps, mission, hold.reason.includes("reserved") ? "insufficient_funds" : "payment_failed", hold.reason);
      return { missionId, action: "action_required", message: hold.reason };
    }
    attempt = await store.updateAttempt(attempt.id, { status: "payment_authorized", paymentReference: hold.reference, updatedAt: now() });
    await audit("payment_authorized", `Hold placed for ${fmt(amount, mission.currency)} via ${gateway.name}`, { reference: hold.reference });

    // 7. Submit the order. From here on, any error is an UNKNOWN outcome.
    const passengers = await store.getPassengerDetails(mission.userId, mission.passengerProfileIds);
    attempt = await store.updateAttempt(attempt.id, { status: "submitted", updatedAt: now() });
    let result: OrderResult;
    try {
      result = await deps.flights.createOrder({ offer: fresh, passengers, amount, currency: mission.currency, idempotencyKey, demoOutcome });
    } catch (err) {
      const timeout = err instanceof ProviderTimeoutError;
      await store.updateAttempt(attempt.id, { status: "unknown", failureReason: errorMessage(err), updatedAt: now() });
      await audit("booking_uncertain", `${timeout ? "Timeout" : "Error"} while submitting order: ${errorMessage(err)}. Will reconcile before any new attempt.`);
      await store.notify({
        userId: mission.userId,
        missionId,
        kind: "booking_uncertain",
        title: "Confirming your booking",
        body: `${mission.title}: the booking provider did not answer in time. FareBuddy is checking whether the order went through and will not submit another order until it knows.`,
        severity: "warning",
        requiresAction: false,
      });
      await store.updateMission(missionId, { statusReason: "Waiting for provider confirmation", nextCheckAt: nextCheck(mission, deps, 1) });
      return { missionId, action: "uncertain", message: "Outcome unknown — reconciling" };
    }

    const outcome = await applyOrderResult(mission, attempt, result, paymentMethod, deps);
    return outcome === "confirmed"
      ? { missionId, action: "booked", message: "Booking confirmed by provider", bestPrice: amount }
      : outcome === "unresolved"
        ? { missionId, action: "uncertain", message: "Order pending provider confirmation" }
        : { missionId, action: "booking_failed", message: result.status === "failed" ? result.reason : "Booking failed" };
  } catch (err) {
    const m = await store.getMission(missionId);
    if (m) await store.updateMission(missionId, { lastError: errorMessage(err) });
    await store.audit({ userId: initial.userId, missionId, kind: "engine_error", message: errorMessage(err), data: {} });
    return { missionId, action: "error", message: errorMessage(err) };
  } finally {
    await store.releaseLock(missionId, lockOwner);
  }
}

type ApplyOutcome = "confirmed" | "failed" | "unresolved";

async function applyOrderResult(
  mission: FlightMission,
  attempt: BookingAttempt,
  result: OrderLookup,
  paymentMethod: PaymentMethod | null,
  deps: EngineDeps,
): Promise<ApplyOutcome> {
  const { store } = deps;
  const now = () => (deps.clock ?? (() => new Date()))().toISOString();
  const audit = (kind: string, message: string, data: Record<string, unknown> = {}) =>
    store.audit({ userId: mission.userId, missionId: mission.id, kind, message, data: { attemptId: attempt.id, ...data } });

  if (result.status === "pending" || result.status === "not_found") {
    await store.updateAttempt(attempt.id, {
      status: "unknown",
      providerReference: result.status === "pending" ? result.providerReference : attempt.providerReference,
      updatedAt: now(),
    });
    return "unresolved";
  }

  if (result.status === "failed") {
    await store.updateAttempt(attempt.id, { status: "failed", failureReason: result.reason, updatedAt: now() });
    if (attempt.paymentReference && paymentMethod) await gatewayFor(paymentMethod, deps).release(attempt.paymentReference);
    await audit("booking_failed", result.reason, { retryable: result.retryable });
    await store.notify({
      userId: mission.userId,
      missionId: mission.id,
      kind: "booking_failed",
      title: "Booking was not completed",
      body: `${mission.title}: ${result.reason}. Any payment hold was released.${result.retryable ? " Monitoring continues." : ""}`,
      severity: "critical",
      requiresAction: !result.retryable,
    });
    await setStatus(deps, mission, result.retryable ? "monitoring" : "booking_failed", result.reason);
    return "failed";
  }

  // Confirmed by the provider.
  const offer = attempt.offerSnapshot!;
  await store.updateAttempt(attempt.id, { status: "confirmed", providerReference: result.providerReference, updatedAt: now() });
  let captureError: string | null = null;
  if (attempt.paymentReference && paymentMethod) {
    try {
      await gatewayFor(paymentMethod, deps).capture(attempt.paymentReference, result.totalAmount, result.currency);
      await audit("payment_captured", `Captured ${fmt(result.totalAmount, result.currency)}`);
    } catch (err) {
      captureError = errorMessage(err);
      await audit("payment_capture_failed", `Booking confirmed but payment capture failed: ${captureError}`);
    }
  }
  const passengers = await store.getPassengerDetails(mission.userId, mission.passengerProfileIds);
  const booking: Booking = {
    id: uuid(),
    missionId: mission.id,
    userId: mission.userId,
    mode: mission.mode,
    provider: deps.flights.name,
    providerBookingReference: result.providerReference,
    airlineBookingReference: result.airlineReference,
    totalPaid: result.totalAmount,
    currency: result.currency,
    bookingStatus: "confirmed",
    ticketingStatus: result.ticketingStatus,
    ticketNumbers: result.ticketNumbers,
    itineraryDetails: offer,
    passengerNames: passengers.map((p) => p.fullLegalName),
    paymentSummary: {
      type: paymentMethod?.paymentType ?? "card",
      label: paymentMethod?.label ?? "Unknown",
      reference: attempt.paymentReference,
    },
    providerConfirmation: { confirmedAt: now(), message: result.message },
    documents: result.documents,
    createdAt: now(),
    updatedAt: now(),
  };
  await store.insertBooking(booking);
  await store.updateMission(mission.id, {
    monitoringStatus: "booked",
    statusReason: captureError ? `Booked — payment capture needs attention: ${captureError}` : null,
    nextCheckAt: result.ticketingStatus === "pending" ? nextCheck(mission, deps, 1) : null,
  });
  await audit("booking_confirmed", `Provider confirmed ${result.providerReference} / PNR ${result.airlineReference}`, {
    ticketing: result.ticketingStatus,
  });
  const demo = mission.mode === "demo" ? "DEMO — " : "";
  await store.notify({
    userId: mission.userId,
    missionId: mission.id,
    kind: "booking_confirmed",
    title: `${demo}Flight booked`,
    body: `${mission.title}: confirmed for ${fmt(result.totalAmount, result.currency)}. Booking reference ${result.airlineReference}.${
      result.ticketingStatus === "pending" ? " Ticket issuance is pending." : ""
    }${mission.mode === "demo" ? " This is a simulated booking — no real ticket was purchased." : ""}`,
    severity: "success",
    requiresAction: false,
  });
  return "confirmed";
}

/** Resolve an attempt whose outcome is not known. Never resubmits an order. */
export async function reconcileAttempt(
  mission: FlightMission,
  attempt: BookingAttempt,
  deps: EngineDeps,
): Promise<ApplyOutcome> {
  const { store } = deps;
  const now = () => (deps.clock ?? (() => new Date()))().toISOString();
  const paymentMethod = mission.paymentMethodId ? await store.getPaymentMethod(mission.paymentMethodId) : null;

  // Crashed before the order was submitted: safe to abort.
  if (attempt.status === "created" || attempt.status === "revalidating" || attempt.status === "payment_authorized") {
    if (attempt.paymentReference && paymentMethod) await gatewayFor(paymentMethod, deps).release(attempt.paymentReference);
    await store.updateAttempt(attempt.id, { status: "aborted", failureReason: "Interrupted before submission", updatedAt: now() });
    await setStatus(deps, mission, "monitoring", null);
    return "failed";
  }

  const lookup = await deps.flights.findOrder(attempt.idempotencyKey, attempt.providerReference);
  const tries = attempt.reconcileAttempts + 1;
  await store.updateAttempt(attempt.id, { reconcileAttempts: tries, updatedAt: now() });
  await store.audit({
    userId: mission.userId,
    missionId: mission.id,
    kind: "reconcile",
    message: `Reconciliation #${tries}: provider reports ${lookup.status}`,
    data: { attemptId: attempt.id },
  });

  if (lookup.status === "not_found" && deps.flights.capabilities.reconcileByKey) {
    const ageMinutes = (Date.parse(now()) - Date.parse(attempt.updatedAt)) / 60000;
    if (tries >= 2 || ageMinutes > 15) {
      // Provider can search by our key and has no such order: it was never created.
      return applyOrderResult(mission, attempt, { status: "failed", reason: "Order was not created by the provider", retryable: true }, paymentMethod, deps);
    }
  }

  const result = await applyOrderResult(mission, attempt, lookup, paymentMethod, deps);
  if (result === "unresolved" && tries >= (deps.maxReconcileAttempts ?? 10)) {
    await setStatus(deps, mission, "action_required", "Booking outcome could not be confirmed automatically");
    await store.notify({
      userId: mission.userId,
      missionId: mission.id,
      kind: "booking_uncertain",
      title: "We need to verify a booking manually",
      body: `${mission.title}: the provider has not confirmed attempt ${attempt.id.slice(0, 8)}. FareBuddy will not retry. Support will verify the outcome.`,
      severity: "critical",
      requiresAction: true,
    });
  }
  return result;
}

async function refreshTicketing(mission: FlightMission, deps: EngineDeps): Promise<CycleResult> {
  const booking = await deps.store.getBookingForMission(mission.id);
  if (!booking || booking.ticketingStatus !== "pending") {
    if (mission.nextCheckAt) await deps.store.updateMission(mission.id, { nextCheckAt: null });
    return { missionId: mission.id, action: "skipped", message: "Booked" };
  }
  const attempts = await findConfirmedKey(mission, booking, deps);
  const lookup = attempts ? await deps.flights.findOrder(attempts, booking.providerBookingReference) : { status: "not_found" as const };
  if (lookup.status === "confirmed" && lookup.ticketingStatus === "issued") {
    await deps.store.updateBooking(booking.id, { ticketingStatus: "issued", ticketNumbers: lookup.ticketNumbers, updatedAt: new Date().toISOString() });
    await deps.store.updateMission(mission.id, { nextCheckAt: null });
    await deps.store.notify({
      userId: mission.userId,
      missionId: mission.id,
      kind: "ticket_issued",
      title: `${mission.mode === "demo" ? "DEMO — " : ""}Ticket issued`,
      body: `${mission.title}: e-ticket(s) ${lookup.ticketNumbers.join(", ")} issued for booking ${booking.airlineBookingReference}.`,
      severity: "success",
      requiresAction: false,
    });
    return { missionId: mission.id, action: "booked", message: "Ticket issued" };
  }
  await deps.store.updateMission(mission.id, { nextCheckAt: nextCheck(mission, deps, 2) });
  return { missionId: mission.id, action: "skipped", message: "Ticketing still pending" };
}

async function findConfirmedKey(mission: FlightMission, booking: Booking, deps: EngineDeps): Promise<string | null> {
  // The idempotency key is deterministic: rebuild it from the booked offer.
  const version = mission.purchaseAuthorization?.version ?? 1;
  const key = `fb_${mission.id}_${booking.itineraryDetails.id}_v${version}`;
  const attempt = await deps.store.findAttemptByKey(key);
  return attempt?.idempotencyKey ?? null;
}

async function expireMission(mission: FlightMission, deps: EngineDeps): Promise<CycleResult> {
  await setStatus(deps, mission, "expired", "Departure date reached without an eligible fare");
  await deps.store.updateMission(mission.id, { nextCheckAt: null });
  if (mission.paymentMethodId) {
    const reservation = await deps.store.getHeldReservation(mission.id, mission.paymentMethodId);
    if (reservation) await deps.store.releaseReservation(reservation.id);
  }
  await deps.store.notify({
    userId: mission.userId,
    missionId: mission.id,
    kind: "mission_expired",
    title: "Mission expired",
    body: `${mission.title}: no eligible fare met your target before departure. Nothing was purchased and any reserved funds were released.`,
    severity: "info",
    requiresAction: false,
  });
  return { missionId: mission.id, action: "expired", message: "Mission expired" };
}

async function failForAction(deps: EngineDeps, mission: FlightMission, kind: "payment_failed" | "insufficient_funds", reason: string) {
  await setStatus(deps, mission, "action_required", reason);
  await deps.store.notify({
    userId: mission.userId,
    missionId: mission.id,
    kind,
    title: kind === "insufficient_funds" ? "Insufficient funds" : "Payment failed",
    body: `${mission.title}: ${reason}. Nothing was booked. Update your payment method and re-authorize to resume.`,
    severity: "critical",
    requiresAction: true,
  });
}

async function setStatus(deps: EngineDeps, mission: FlightMission, status: MissionStatus, reason: string | null) {
  if (mission.monitoringStatus === status && mission.statusReason === reason) return;
  await deps.store.updateMission(mission.id, { monitoringStatus: status, statusReason: reason });
  await deps.store.audit({
    userId: mission.userId,
    missionId: mission.id,
    kind: "status_change",
    message: `${mission.monitoringStatus} → ${status}${reason ? `: ${reason}` : ""}`,
    data: { from: mission.monitoringStatus, to: status },
  });
  mission.monitoringStatus = status;
  mission.statusReason = reason;
}

function gatewayFor(pm: PaymentMethod, deps: EngineDeps): PaymentGateway {
  return pm.paymentType === "card" ? deps.cardGateway : deps.walletGateway;
}

export function nextCheck(mission: FlightMission, deps: EngineDeps, overrideMinutes?: number): string {
  const clock = deps.clock ?? (() => new Date());
  const minutes = overrideMinutes ?? mission.monitoringIntervalMinutes;
  const speed = mission.mode === "demo" && overrideMinutes === undefined ? Math.max(1, deps.demoSpeed ?? 1) : 1;
  return new Date(clock().getTime() + (minutes * 60000) / speed).toISOString();
}

function snapshot(e: EvaluatedOffer, provider: string, observedAt: string): OfferSnapshot {
  return {
    offerId: e.offer.id,
    provider,
    totalAmount: e.payableTotal,
    currency: e.offer.currency,
    carriers: [...new Set(e.offer.slices.flatMap((s) => s.segments.map((x) => x.marketingCarrier)))],
    stops: e.offer.slices.map((s) => s.segments.length - 1),
    durationMinutes: e.offer.slices.map((s) => s.durationMinutes),
    summary: describeOffer(e.offer),
    observedAt,
    offer: e.offer,
  };
}

function fmt(amount: number, currency: string) {
  return amount.toLocaleString("en-US", { style: "currency", currency });
}

/** Run every due mission. Used by the scheduled worker and the demo scheduler. */
export async function runDueMissions(deps: EngineDeps, limit = 25): Promise<CycleResult[]> {
  const nowIso = (deps.clock ?? (() => new Date()))().toISOString();
  const due = await deps.store.listDueMissions(nowIso, limit);
  const results: CycleResult[] = [];
  for (const m of due) {
    try {
      results.push(await runMissionCycle(m.id, deps));
    } catch (err) {
      results.push({ missionId: m.id, action: "error", message: errorMessage(err) });
    }
  }
  return results;
}
