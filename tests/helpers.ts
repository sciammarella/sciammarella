import {
  buildAuthorization,
  DemoCardGateway,
  DemoFlightProvider,
  defaultPreferences,
  type EngineDeps,
  type FlightMission,
  placeRef,
  type PaymentMethod,
  WalletGateway,
  withResolvedAirports,
} from "@engine/index.ts";
import { emptyDatabase, MemoryEngineStore } from "@engine/memoryStore.ts";

export const USER = "user-1";

export function setup(opts: { clock?: () => Date } = {}) {
  const db = emptyDatabase();
  const store = new MemoryEngineStore(db, {
    clock: opts.clock,
    decryptPassenger: async (r) => ({
      id: r.summary.id,
      fullLegalName: r.summary.displayName,
      givenName: "Ana",
      familyName: "Souza",
      dateOfBirth: "1990-04-02",
      gender: "female",
      nationality: "BR",
      passportNumber: "FX123456",
      passportIssuingCountry: "BR",
      passportExpiry: "2031-01-01",
      email: "ana@example.com",
      phone: "+5527999999999",
      frequentFlyer: null,
    }),
  });
  const flights = new DemoFlightProvider(store.providerState(), opts.clock);
  const deps: EngineDeps = {
    store,
    flights,
    cardGateway: new DemoCardGateway(),
    walletGateway: new WalletGateway(store, "demo"),
    clock: opts.clock,
    workerId: "test",
  };
  db.passengers.push({
    summary: {
      id: "pax-1",
      userId: USER,
      displayName: "Ana Souza",
      passengerType: "adult",
      nationality: "BR",
      passportLast4: "3456",
      passportExpiry: "2031-01-01",
      createdAt: "",
      updatedAt: "",
    },
    encrypted: "",
  });
  const card: PaymentMethod = {
    id: "pm-card",
    userId: USER,
    mode: "demo",
    paymentType: "card",
    label: "Demo Visa •••• 4242",
    provider: "demo-card",
    providerReference: null,
    tokenOrWalletReference: "tok_demo",
    currency: "USD",
    authorizationStatus: "active",
    card: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 },
    wallet: null,
    confirmedBalance: null,
    createdAt: "",
  };
  db.paymentMethods.push(card);
  return { db, store, flights, deps, card };
}

export function makeMission(overrides: Partial<FlightMission> = {}, autoPurchase = true): FlightMission {
  const base: FlightMission = {
    id: "mission-1",
    userId: USER,
    mode: "demo",
    title: "Vitória → Tokyo",
    origin: placeRef("VIX"),
    destination: placeRef("TYO"),
    departureDate: "2026-12-25",
    returnDate: "2027-01-12",
    passengerProfileIds: ["pax-1"],
    preferences: defaultPreferences(),
    targetPrice: 1000,
    maximumAuthorizedAmount: 1000,
    priceTolerance: 0,
    currency: "USD",
    paymentMethodId: "pm-card",
    monitoringStatus: "monitoring",
    monitoringIntervalMinutes: 60,
    purchaseAuthorization: null,
    bestOffer: null,
    lowestObserved: null,
    lastCheckedAt: null,
    nextCheckAt: "2026-01-01T00:00:00.000Z",
    checkCount: 0,
    lastError: null,
    statusReason: null,
    notificationState: {},
    demoControls: null,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
  base.preferences = withResolvedAirports(base, { ...base.preferences, ...(overrides.preferences ?? {}) });
  const pm = { id: base.paymentMethodId!, label: "Demo Visa •••• 4242" } as PaymentMethod;
  base.purchaseAuthorization = buildAuthorization(base, pm, ["Ana Souza"], autoPurchase, "2026-10-10T00:00:00Z");
  return base;
}
