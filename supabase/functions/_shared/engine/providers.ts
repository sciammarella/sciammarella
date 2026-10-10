import type {
  CabinClass,
  Currency,
  DemoOutcome,
  FlightOffer,
  PassengerCounts,
  PassengerDetails,
  PaymentMethod,
  RuntimeMode,
  TicketingStatus,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Flight search & booking provider contract

export interface FlightSearchSlice {
  originAirports: string[];
  destinationAirports: string[];
  /** Candidate dates the user authorized (exact date, or ±flexible days). */
  departureDates: string[];
}

export interface FlightSearchRequest {
  missionId: string;
  slices: FlightSearchSlice[];
  passengers: PassengerCounts;
  cabin: CabinClass;
  maxConnections: number;
  currency: Currency;
  /** Demo-only simulation inputs. Ignored by live providers. */
  demo?: {
    seed: string;
    tick: number;
    flashSaleAmount?: number | null;
    isEligible?: (offer: FlightOffer) => boolean;
  };
}

export interface ProviderCapabilities {
  search: boolean;
  revalidate: boolean;
  createOrder: boolean;
  instantTicketing: boolean;
  /** Provider can look up an order by our idempotency key after a timeout. */
  reconcileByKey: boolean;
}

export interface CreateOrderInput {
  offer: FlightOffer;
  passengers: PassengerDetails[];
  amount: number;
  currency: Currency;
  idempotencyKey: string;
  demoOutcome?: DemoOutcome;
}

export type OrderResult =
  | {
      status: "confirmed";
      providerReference: string;
      airlineReference: string;
      ticketingStatus: TicketingStatus;
      ticketNumbers: string[];
      totalAmount: number;
      currency: Currency;
      message: string;
      documents: { label: string; url: string }[];
    }
  | { status: "pending"; providerReference: string | null; message: string }
  | { status: "failed"; reason: string; retryable: boolean };

export type OrderLookup = OrderResult | { status: "not_found" };

/** Thrown when the provider did not answer in time: the outcome is unknown. */
export class ProviderTimeoutError extends Error {
  constructor(message = "Booking provider did not respond in time") {
    super(message);
    this.name = "ProviderTimeoutError";
  }
}

export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export interface FlightProvider {
  readonly name: string;
  readonly mode: RuntimeMode;
  readonly capabilities: ProviderCapabilities;
  search(request: FlightSearchRequest): Promise<FlightOffer[]>;
  /** Re-price an offer right before purchase. Returns null if it is no longer available. */
  revalidate(offer: FlightOffer, request: FlightSearchRequest): Promise<FlightOffer | null>;
  /** May throw ProviderTimeoutError — the caller must then reconcile, never blindly retry. */
  createOrder(input: CreateOrderInput): Promise<OrderResult>;
  findOrder(idempotencyKey: string, providerReference: string | null): Promise<OrderLookup>;
}

// ---------------------------------------------------------------------------
// Payment gateway contract

export interface AuthorizePaymentInput {
  paymentMethod: PaymentMethod;
  missionId: string;
  amount: number;
  currency: Currency;
  idempotencyKey: string;
  demoOutcome?: DemoOutcome;
}

export type AuthorizeResult =
  | { status: "authorized"; reference: string }
  | { status: "declined"; reason: string }
  | { status: "requires_action"; reason: string };

export interface PaymentGateway {
  readonly name: string;
  readonly mode: RuntimeMode;
  /** Place a hold / earmark funds. Nothing is captured yet. */
  authorize(input: AuthorizePaymentInput): Promise<AuthorizeResult>;
  /** Capture after the booking provider confirmed the order. */
  capture(reference: string, amount: number, currency: Currency): Promise<void>;
  /** Release a hold after a definitive booking failure. */
  release(reference: string): Promise<void>;
}

/** Small persistent key/value store used by stateful providers (e.g. demo orders). */
export interface ProviderStateStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
}

export class MemoryStateStore implements ProviderStateStore {
  private map = new Map<string, unknown>();
  async get<T>(key: string) {
    return (this.map.get(key) as T) ?? null;
  }
  async set<T>(key: string, value: T) {
    this.map.set(key, structuredClone(value));
  }
}
