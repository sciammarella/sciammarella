// Mapping between PostgreSQL rows (snake_case) and domain objects (camelCase).
// Shared by the Edge Functions (service role) and the browser (RLS reads).

import type {
  AppNotification,
  AuditEvent,
  Booking,
  BookingAttempt,
  FlightMission,
  PassengerSummary,
  PaymentMethod,
  PriceObservation,
  WalletReservation,
  WalletTransaction,
} from "./types.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export const missionFromRow = (r: Row): FlightMission => ({
  id: r.id,
  userId: r.user_id,
  mode: r.mode,
  title: r.title,
  origin: r.origin,
  destination: r.destination,
  departureDate: r.departure_date,
  returnDate: r.return_date,
  passengerProfileIds: r.passenger_profile_ids ?? [],
  preferences: r.flight_preferences,
  targetPrice: num(r.target_price),
  maximumAuthorizedAmount: num(r.maximum_authorized_amount),
  priceTolerance: num(r.price_tolerance),
  currency: r.currency,
  paymentMethodId: r.payment_method_id,
  monitoringStatus: r.monitoring_status,
  monitoringIntervalMinutes: r.monitoring_interval_minutes,
  purchaseAuthorization: r.purchase_authorization,
  bestOffer: r.best_offer,
  lowestObserved: numOrNull(r.lowest_observed),
  lastCheckedAt: r.last_checked_at,
  nextCheckAt: r.next_check_at,
  checkCount: r.check_count,
  lastError: r.last_error,
  statusReason: r.status_reason,
  notificationState: r.notification_state ?? {},
  demoControls: r.demo_controls,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const MISSION_COLUMNS: Record<keyof FlightMission, string> = {
  id: "id",
  userId: "user_id",
  mode: "mode",
  title: "title",
  origin: "origin",
  destination: "destination",
  departureDate: "departure_date",
  returnDate: "return_date",
  passengerProfileIds: "passenger_profile_ids",
  preferences: "flight_preferences",
  targetPrice: "target_price",
  maximumAuthorizedAmount: "maximum_authorized_amount",
  priceTolerance: "price_tolerance",
  currency: "currency",
  paymentMethodId: "payment_method_id",
  monitoringStatus: "monitoring_status",
  monitoringIntervalMinutes: "monitoring_interval_minutes",
  purchaseAuthorization: "purchase_authorization",
  bestOffer: "best_offer",
  lowestObserved: "lowest_observed",
  lastCheckedAt: "last_checked_at",
  nextCheckAt: "next_check_at",
  checkCount: "check_count",
  lastError: "last_error",
  statusReason: "status_reason",
  notificationState: "notification_state",
  demoControls: "demo_controls",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

export function missionToRow(patch: Partial<FlightMission>): Row {
  const row: Row = {};
  for (const [k, v] of Object.entries(patch)) {
    const col = MISSION_COLUMNS[k as keyof FlightMission];
    if (col && v !== undefined && k !== "updatedAt") row[col] = v;
  }
  return row;
}

export const observationFromRow = (r: Row): PriceObservation => ({
  id: r.id,
  missionId: r.mission_id,
  provider: r.provider,
  itineraryReference: r.itinerary_reference,
  totalPrice: num(r.total_price),
  currency: r.currency,
  observedAt: r.observed_at,
  eligible: r.eligible,
  offerMetadata: r.offer_metadata,
});

export const attemptFromRow = (r: Row): BookingAttempt => ({
  id: r.id,
  missionId: r.mission_id,
  userId: r.user_id,
  mode: r.mode,
  offerId: r.offer_id,
  providerReference: r.provider_reference,
  paymentReference: r.payment_reference,
  idempotencyKey: r.idempotency_key,
  status: r.status,
  amount: num(r.amount),
  currency: r.currency,
  failureReason: r.failure_reason,
  reconcileAttempts: r.reconcile_attempts,
  offerSnapshot: r.offer_snapshot,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function attemptToRow(a: Partial<BookingAttempt>): Row {
  const map: Record<string, string> = {
    id: "id",
    missionId: "mission_id",
    userId: "user_id",
    mode: "mode",
    offerId: "offer_id",
    providerReference: "provider_reference",
    paymentReference: "payment_reference",
    idempotencyKey: "idempotency_key",
    status: "status",
    amount: "amount",
    currency: "currency",
    failureReason: "failure_reason",
    reconcileAttempts: "reconcile_attempts",
    offerSnapshot: "offer_snapshot",
    createdAt: "created_at",
  };
  const row: Row = {};
  for (const [k, v] of Object.entries(a)) if (map[k] && v !== undefined) row[map[k]] = v;
  return row;
}

export const bookingFromRow = (r: Row): Booking => ({
  id: r.id,
  missionId: r.mission_id,
  userId: r.user_id,
  mode: r.mode,
  provider: r.provider,
  providerBookingReference: r.provider_booking_reference,
  airlineBookingReference: r.airline_booking_reference,
  totalPaid: num(r.total_paid),
  currency: r.currency,
  bookingStatus: r.booking_status,
  ticketingStatus: r.ticketing_status,
  ticketNumbers: r.ticket_numbers ?? [],
  itineraryDetails: r.itinerary_details,
  passengerNames: r.passenger_names ?? [],
  paymentSummary: r.payment_summary,
  providerConfirmation: r.provider_confirmation,
  documents: r.documents ?? [],
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function bookingToRow(b: Partial<Booking>): Row {
  const map: Record<string, string> = {
    id: "id",
    missionId: "mission_id",
    userId: "user_id",
    mode: "mode",
    provider: "provider",
    providerBookingReference: "provider_booking_reference",
    airlineBookingReference: "airline_booking_reference",
    totalPaid: "total_paid",
    currency: "currency",
    bookingStatus: "booking_status",
    ticketingStatus: "ticketing_status",
    ticketNumbers: "ticket_numbers",
    itineraryDetails: "itinerary_details",
    passengerNames: "passenger_names",
    paymentSummary: "payment_summary",
    providerConfirmation: "provider_confirmation",
    documents: "documents",
    createdAt: "created_at",
  };
  const row: Row = {};
  for (const [k, v] of Object.entries(b)) if (map[k] && v !== undefined) row[map[k]] = v;
  return row;
}

export const paymentMethodFromRow = (r: Row): PaymentMethod => ({
  id: r.id,
  userId: r.user_id,
  mode: r.mode,
  paymentType: r.payment_type,
  label: r.label,
  provider: r.provider,
  providerReference: r.provider_reference,
  tokenOrWalletReference: r.token_or_wallet_reference,
  currency: r.currency,
  authorizationStatus: r.authorization_status,
  card: r.card,
  wallet: r.wallet,
  confirmedBalance: numOrNull(r.available_balance),
  createdAt: r.created_at,
});

export const paymentMethodToRow = (p: PaymentMethod): Row => ({
  id: p.id,
  user_id: p.userId,
  mode: p.mode,
  payment_type: p.paymentType,
  label: p.label,
  provider: p.provider,
  provider_reference: p.providerReference,
  token_or_wallet_reference: p.tokenOrWalletReference,
  currency: p.currency,
  available_balance: p.confirmedBalance,
  authorization_status: p.authorizationStatus,
  card: p.card ?? null,
  wallet: p.wallet ?? null,
  created_at: p.createdAt,
});

export const walletTxFromRow = (r: Row): WalletTransaction => ({
  id: r.id,
  paymentMethodId: r.payment_method_id,
  userId: r.user_id,
  direction: r.direction,
  amount: num(r.amount),
  token: r.token,
  network: r.network,
  txHash: r.tx_hash,
  confirmations: r.confirmations,
  requiredConfirmations: r.required_confirmations,
  status: r.status,
  createdAt: r.created_at,
});

export const walletTxToRow = (t: WalletTransaction): Row => ({
  id: t.id,
  payment_method_id: t.paymentMethodId,
  user_id: t.userId,
  direction: t.direction,
  amount: t.amount,
  token: t.token,
  network: t.network,
  tx_hash: t.txHash,
  confirmations: t.confirmations,
  required_confirmations: t.requiredConfirmations,
  status: t.status,
  created_at: t.createdAt,
});

export const reservationFromRow = (r: Row): WalletReservation => ({
  id: r.id,
  paymentMethodId: r.payment_method_id,
  missionId: r.mission_id,
  userId: r.user_id,
  amount: num(r.amount),
  status: r.status,
  capturedAmount: num(r.captured_amount),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const passengerSummaryFromRow = (r: Row): PassengerSummary => ({
  id: r.id,
  userId: r.user_id,
  displayName: r.display_name,
  passengerType: r.passenger_type,
  nationality: r.nationality,
  passportLast4: r.passport_last4,
  passportExpiry: r.passport_expiry,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const notificationFromRow = (r: Row): AppNotification => ({
  id: r.id,
  userId: r.user_id,
  missionId: r.mission_id,
  kind: r.kind,
  title: r.title,
  body: r.body,
  severity: r.severity,
  requiresAction: r.requires_action,
  readAt: r.read_at,
  createdAt: r.created_at,
});

export const auditFromRow = (r: Row): AuditEvent => ({
  id: r.id,
  userId: r.user_id,
  missionId: r.mission_id,
  kind: r.kind,
  message: r.message,
  data: r.data ?? {},
  createdAt: r.created_at,
});
