import type {
  AppNotification,
  AuditEvent,
  Booking,
  BookingAttempt,
  ChainNetwork,
  CycleResult,
  DemoControls,
  FlightMission,
  PassengerSummary,
  PaymentMethod,
  PriceObservation,
  ReadinessCheck,
  RuntimeMode,
  StablecoinToken,
  WalletTransaction,
} from "@engine/index.ts";
import type { DocumentCheck } from "@engine/mission.ts";
import type { ActivationIssue, MissionInput, PassengerInput, WalletAvailability } from "@engine/service.ts";

export interface Session {
  userId: string;
  email: string;
  fullName: string;
}

export interface SystemStatus {
  backend: "browser" | "supabase";
  mode: RuntimeMode;
  liveAvailable: boolean;
  checks: ReadinessCheck[];
  demoSpeed: number;
  scheduler: "browser" | "server";
  passengerEncryption: "browser-demo" | "server" | "missing";
  stripePublishableKey: string | null;
}

export class BackendError extends Error {
  constructor(
    message: string,
    public details: string[] = [],
  ) {
    super(message);
    this.name = "BackendError";
  }
}

export interface PassengerDocumentReport {
  passengerId: string;
  name: string;
  checks: DocumentCheck[];
}

export interface Backend {
  readonly kind: "browser" | "supabase";
  status(): Promise<SystemStatus>;

  getSession(): Promise<Session | null>;
  onAuthChange(cb: (s: Session | null) => void): () => void;
  signUp(email: string, password: string, fullName: string): Promise<{ session: Session | null; confirmEmail: boolean }>;
  signIn(email: string, password: string): Promise<Session>;
  signOut(): Promise<void>;

  /** Fires whenever data may have changed (local writes, realtime events, scheduler runs). */
  subscribe(cb: () => void): () => void;

  listMissions(): Promise<FlightMission[]>;
  getMission(id: string): Promise<FlightMission | null>;
  listObservations(missionId: string): Promise<PriceObservation[]>;
  listAttempts(missionId: string): Promise<BookingAttempt[]>;
  listAudit(missionId: string | null, limit?: number): Promise<AuditEvent[]>;
  listBookings(): Promise<Booking[]>;
  getBooking(id: string): Promise<Booking | null>;

  saveMission(input: MissionInput): Promise<{ mission: FlightMission; materialChanges: string[] }>;
  activationCheck(missionId: string): Promise<ActivationIssue[]>;
  activateMission(missionId: string, autoPurchase: boolean): Promise<FlightMission>;
  pauseMission(missionId: string): Promise<FlightMission>;
  resumeMission(missionId: string): Promise<FlightMission>;
  cancelMission(missionId: string): Promise<FlightMission>;
  checkNow(missionId: string): Promise<CycleResult>;
  approvePurchase(missionId: string): Promise<CycleResult>;
  setDemoControls(missionId: string, controls: DemoControls): Promise<void>;

  listPassengers(): Promise<PassengerSummary[]>;
  getPassenger(id: string): Promise<PassengerInput>;
  savePassenger(input: PassengerInput): Promise<PassengerSummary>;
  deletePassenger(id: string): Promise<void>;
  documentChecks(missionId: string): Promise<PassengerDocumentReport[]>;

  listPaymentMethods(): Promise<PaymentMethod[]>;
  addDemoCard(brand: string): Promise<PaymentMethod>;
  addDemoWallet(token: StablecoinToken, network: ChainNetwork): Promise<PaymentMethod>;
  simulateDeposit(paymentMethodId: string, amount: number): Promise<void>;
  walletAvailability(paymentMethodId: string): Promise<WalletAvailability>;
  listWalletTransactions(paymentMethodId: string): Promise<WalletTransaction[]>;
  removePaymentMethod(id: string): Promise<void>;
  stripeSetupIntent(): Promise<{ clientSecret: string; setupIntentId: string }>;
  stripeFinalize(setupIntentId: string): Promise<PaymentMethod>;

  listNotifications(): Promise<AppNotification[]>;
  markNotificationRead(id: string): Promise<void>;
  markAllNotificationsRead(): Promise<void>;
}
