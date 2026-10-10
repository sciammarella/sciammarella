import type {
  AppNotification,
  AuditEvent,
  Booking,
  BookingAttempt,
  FlightMission,
  PassengerDetails,
  PaymentMethod,
  PriceObservation,
  WalletReservation,
} from "./types.ts";

export class DuplicateAttemptError extends Error {
  constructor(key: string) {
    super(`A booking attempt with idempotency key ${key} already exists`);
    this.name = "DuplicateAttemptError";
  }
}

export const UNRESOLVED_ATTEMPT_STATUSES = ["created", "revalidating", "payment_authorized", "submitted", "unknown"] as const;

export type NewNotification = Omit<AppNotification, "id" | "createdAt" | "readAt">;
export type NewAuditEvent = Omit<AuditEvent, "id" | "createdAt">;

/**
 * Persistence contract for the booking engine. Implemented by the browser demo
 * store (localStorage) and the Supabase service-role store (PostgreSQL).
 */
export interface EngineStore {
  getMission(id: string): Promise<FlightMission | null>;
  updateMission(id: string, patch: Partial<FlightMission>): Promise<FlightMission>;
  listDueMissions(nowIso: string, limit: number): Promise<FlightMission[]>;

  getPaymentMethod(id: string): Promise<PaymentMethod | null>;
  /** Decrypted passenger data. Server-side only; never logged. */
  getPassengerDetails(userId: string, ids: string[]): Promise<PassengerDetails[]>;

  addObservation(observation: PriceObservation): Promise<void>;

  /** Atomic compare-and-set lock. Returns false if another worker holds a live lock. */
  acquireLock(missionId: string, owner: string, ttlSeconds: number): Promise<boolean>;
  releaseLock(missionId: string, owner: string): Promise<void>;

  findAttemptByKey(idempotencyKey: string): Promise<BookingAttempt | null>;
  /** Must throw DuplicateAttemptError when the idempotency key already exists. */
  insertAttempt(attempt: BookingAttempt): Promise<BookingAttempt>;
  updateAttempt(id: string, patch: Partial<BookingAttempt>): Promise<BookingAttempt>;
  listUnresolvedAttempts(missionId: string): Promise<BookingAttempt[]>;

  getBookingForMission(missionId: string): Promise<Booking | null>;
  insertBooking(booking: Booking): Promise<Booking>;
  updateBooking(id: string, patch: Partial<Booking>): Promise<Booking>;

  getHeldReservation(missionId: string, paymentMethodId: string): Promise<WalletReservation | null>;
  /** Atomically mark captured, debit the wallet balance and release the unused remainder. */
  captureReservation(reservationId: string, amount: number): Promise<void>;
  releaseReservation(reservationId: string): Promise<void>;

  notify(notification: NewNotification): Promise<void>;
  audit(event: NewAuditEvent): Promise<void>;
}
