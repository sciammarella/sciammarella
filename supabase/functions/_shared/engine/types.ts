// Domain types shared by the web app (demo runtime) and Supabase Edge Functions.
// Keep this file free of Node, Deno and DOM specific APIs.

export type RuntimeMode = "demo" | "live";

export type MissionStatus =
  | "draft"
  | "monitoring"
  | "target_reached"
  | "booking_in_progress"
  | "booked"
  | "action_required"
  | "paused"
  | "expired"
  | "booking_failed"
  | "cancelled";

/** States only the booking engine (service role) may set. */
export const ENGINE_ONLY_STATUSES: MissionStatus[] = [
  "target_reached",
  "booking_in_progress",
  "booked",
  "booking_failed",
  "expired",
];

export type TripType = "round_trip" | "one_way";
export type CabinClass = "economy" | "premium_economy" | "business" | "first";
export type TimeWindow = "morning" | "afternoon" | "evening" | "any";
export type RankingStrategy = "lowest_price" | "shortest_duration" | "fewest_stops" | "preferred_airline";
export type Currency = "USD" | "EUR" | "BRL" | "GBP" | "JPY";

export interface PassengerCounts {
  adults: number;
  children: number;
  infants: number;
}

export interface PlaceRef {
  /** IATA airport or metropolitan area code, e.g. VIX or TYO. */
  code: string;
  label: string;
}

export interface FlightPreferences {
  tripType: TripType;
  /** Concrete airport codes the outbound may depart from / the return may arrive at. */
  originAirports: string[];
  /** Concrete airport codes the outbound may arrive at / the return may depart from. */
  destinationAirports: string[];
  allowNearbyAirports: boolean;
  /** 0 = exact dates. N = the user explicitly authorizes ±N days. */
  flexibleDays: number;
  outboundTimeWindow: TimeWindow;
  returnTimeWindow: TimeWindow;
  /** Maximum stops per direction. */
  maxStops: number;
  preferredAirlines: string[];
  /** "prefer" ranks preferred airlines higher, "only" makes them mandatory. */
  airlineMode: "prefer" | "only";
  cabin: CabinClass;
  minConnectionMinutes: number;
  /** Maximum travel time per direction, in hours. null = no limit. */
  maxDurationHours: number | null;
  /** Checked bags required per passenger (infants excluded). */
  checkedBagsPerPassenger: number;
  passengers: PassengerCounts;
  maxPricePerPassenger: number | null;
  /** Allow arriving at one allowed airport and departing from another (e.g. into NRT, out of HND). */
  allowMixedAirports: boolean;
  /** Allow itineraries that combine several airlines. */
  allowMixedCarriers: boolean;
  ranking: RankingStrategy;
}

export interface PurchaseAuthorization {
  autoPurchase: boolean;
  maxAmount: number;
  currency: Currency;
  paymentMethodId: string;
  passengerProfileIds: string[];
  /** Hash of every constraint the user approved. Any material edit invalidates it. */
  constraintsHash: string;
  /** Human readable lines shown at authorization time. */
  summary: string[];
  consentText: string;
  authorizedAt: string;
  version: number;
  revokedAt: string | null;
}

export interface DemoControls {
  /** One-shot: next search includes a fare at this total price. */
  flashSaleAmount?: number | null;
  /** Outcome the demo booking provider will produce for the next order. */
  nextOutcome?: DemoOutcome;
}

export type DemoOutcome =
  | "success"
  | "pending_ticketing"
  | "timeout_then_confirmed"
  | "timeout_then_failed"
  | "offer_gone"
  | "price_jump"
  | "payment_declined";

export interface OfferSnapshot {
  offerId: string;
  provider: string;
  totalAmount: number;
  currency: Currency;
  carriers: string[];
  stops: number[];
  durationMinutes: number[];
  summary: string;
  observedAt: string;
  /** Full offer as last observed (for display). */
  offer?: FlightOffer;
}

export interface FlightMission {
  id: string;
  userId: string;
  mode: RuntimeMode;
  title: string;
  origin: PlaceRef;
  destination: PlaceRef;
  departureDate: string; // YYYY-MM-DD
  returnDate: string | null;
  passengerProfileIds: string[];
  preferences: FlightPreferences;
  targetPrice: number;
  maximumAuthorizedAmount: number;
  /** Allowed overrun above maximumAuthorizedAmount. Defaults to 0 and is never negative. */
  priceTolerance: number;
  currency: Currency;
  paymentMethodId: string | null;
  monitoringStatus: MissionStatus;
  monitoringIntervalMinutes: number;
  purchaseAuthorization: PurchaseAuthorization | null;
  bestOffer: OfferSnapshot | null;
  lowestObserved: number | null;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  checkCount: number;
  lastError: string | null;
  statusReason: string | null;
  notificationState: { approaching?: boolean; reached?: boolean };
  demoControls: DemoControls | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Offers

export interface Segment {
  marketingCarrier: string;
  operatingCarrier: string;
  flightNumber: string;
  origin: string;
  destination: string;
  /** Local time at origin, ISO without offset, e.g. 2026-12-25T08:40:00 */
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  aircraft: string;
  cabin: CabinClass;
}

export interface Slice {
  origin: string;
  destination: string;
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  segments: Segment[];
}

export interface FlightOffer {
  id: string;
  provider: string;
  mode: RuntimeMode;
  totalAmount: number;
  baseAmount: number;
  taxAmount: number;
  currency: Currency;
  slices: Slice[];
  owner: string;
  passengers: PassengerCounts;
  includedCheckedBagsPerPassenger: number;
  /** Price per additional checked bag, per passenger per slice. null = cannot be added. */
  extraBagPrice: number | null;
  fareBrand: string;
  refundable: boolean;
  expiresAt: string;
  /** Opaque provider data needed to book (e.g. provider passenger ids). */
  providerData?: Record<string, unknown>;
}

/** Offer after normalization against a mission's requirements. */
export interface EvaluatedOffer {
  offer: FlightOffer;
  /** Price including mandatory extras (e.g. required baggage). */
  payableTotal: number;
  requiredBagCost: number;
  eligible: boolean;
  violations: string[];
  withinTarget: boolean;
  withinAuthorization: boolean;
  totalDurationMinutes: number;
  totalStops: number;
}

// ---------------------------------------------------------------------------
// Records

export interface PriceObservation {
  id: string;
  missionId: string;
  provider: string;
  itineraryReference: string;
  totalPrice: number;
  currency: Currency;
  observedAt: string;
  eligible: boolean;
  offerMetadata: {
    carriers: string[];
    stops: number[];
    durationMinutes: number[];
    summary: string;
    offersSeen: number;
    eligibleCount: number;
  };
}

export type BookingAttemptStatus =
  | "created"
  | "revalidating"
  | "payment_authorized"
  | "submitted"
  | "unknown" // timed out / uncertain — must be reconciled, never blindly retried
  | "confirmed"
  | "failed"
  | "aborted";

export interface BookingAttempt {
  id: string;
  missionId: string;
  userId: string;
  mode: RuntimeMode;
  offerId: string;
  providerReference: string | null;
  paymentReference: string | null;
  idempotencyKey: string;
  status: BookingAttemptStatus;
  amount: number;
  currency: Currency;
  failureReason: string | null;
  reconcileAttempts: number;
  /** Offer as revalidated right before purchase — used to build the booking after reconciliation. */
  offerSnapshot: FlightOffer | null;
  createdAt: string;
  updatedAt: string;
}

export type TicketingStatus = "issued" | "pending" | "not_issued";

export interface Booking {
  id: string;
  missionId: string;
  userId: string;
  mode: RuntimeMode;
  provider: string;
  providerBookingReference: string;
  airlineBookingReference: string;
  totalPaid: number;
  currency: Currency;
  bookingStatus: "confirmed" | "cancelled";
  ticketingStatus: TicketingStatus;
  ticketNumbers: string[];
  itineraryDetails: FlightOffer;
  passengerNames: string[];
  paymentSummary: { type: PaymentType; label: string; reference: string | null };
  providerConfirmation: { confirmedAt: string; message: string };
  documents: { label: string; url: string }[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Payments

export type PaymentType = "card" | "stablecoin_wallet";
export type AuthorizationStatus = "active" | "pending" | "revoked" | "requires_action";
export type StablecoinToken = "USDC" | "USDT";
export type ChainNetwork = "ethereum" | "base" | "polygon" | "solana" | "tron";

export interface PaymentMethod {
  id: string;
  userId: string;
  mode: RuntimeMode;
  paymentType: PaymentType;
  label: string;
  provider: string;
  providerReference: string | null;
  /** Card: provider payment-method token. Wallet: provider wallet id. Never a raw PAN or key. */
  tokenOrWalletReference: string | null;
  currency: Currency;
  authorizationStatus: AuthorizationStatus;
  card?: { brand: string; last4: string; expMonth: number; expYear: number } | null;
  wallet?: {
    token: StablecoinToken;
    network: ChainNetwork;
    depositAddress: string;
    tokenContract: string;
    requiredConfirmations: number;
  } | null;
  /** Confirmed balance (wallets only). Never includes pending deposits. */
  confirmedBalance: number | null;
  createdAt: string;
}

export interface WalletTransaction {
  id: string;
  paymentMethodId: string;
  userId: string;
  direction: "deposit" | "spend" | "refund";
  amount: number;
  token: StablecoinToken;
  network: ChainNetwork;
  txHash: string;
  confirmations: number;
  requiredConfirmations: number;
  status: "pending" | "confirmed" | "failed";
  createdAt: string;
}

export interface WalletReservation {
  id: string;
  paymentMethodId: string;
  missionId: string;
  userId: string;
  amount: number;
  status: "held" | "captured" | "released";
  capturedAmount: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Passengers

export interface PassengerDetails {
  id: string;
  fullLegalName: string;
  givenName: string;
  familyName: string;
  dateOfBirth: string;
  gender: "female" | "male" | "unspecified" | null;
  nationality: string;
  passportNumber: string;
  passportIssuingCountry: string;
  passportExpiry: string;
  email: string;
  phone: string;
  frequentFlyer: { airline: string; number: string } | null;
}

/** Non-sensitive projection safe to show in lists. */
export interface PassengerSummary {
  id: string;
  userId: string;
  displayName: string;
  passengerType: "adult" | "child" | "infant";
  nationality: string;
  passportLast4: string | null;
  passportExpiry: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Notifications & audit

export type NotificationKind =
  | "approaching_target"
  | "target_reached"
  | "purchase_started"
  | "booking_confirmed"
  | "ticket_issued"
  | "payment_failed"
  | "offer_unavailable"
  | "price_changed"
  | "authorization_required"
  | "mission_expired"
  | "booking_failed"
  | "booking_uncertain"
  | "insufficient_funds"
  | "info";

export interface AppNotification {
  id: string;
  userId: string;
  missionId: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  severity: "info" | "success" | "warning" | "critical";
  requiresAction: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  userId: string;
  missionId: string | null;
  kind: string;
  message: string;
  data: Record<string, unknown>;
  createdAt: string;
}
