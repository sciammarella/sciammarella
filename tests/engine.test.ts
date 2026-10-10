import { describe, expect, it } from "vitest";
import { buildSearchRequest, evaluateOffer, rankOffers, runMissionCycle } from "@engine/index.ts";
import { makeMission, setup } from "./helpers.ts";

const clock = () => new Date("2026-10-10T12:00:00Z");

describe("demo flight provider", () => {
  it("generates realistic round-trip offers VIX → Tokyo with 2 stops", async () => {
    const { flights } = setup({ clock });
    const m = makeMission();
    const offers = await flights.search({ ...buildSearchRequest(m), demo: { seed: m.id, tick: 0 } });
    expect(offers.length).toBeGreaterThan(10);
    const o = offers[0];
    expect(o.slices).toHaveLength(2);
    expect(["HND", "NRT"]).toContain(o.slices[0].destination);
    expect(o.slices[0].origin).toBe("VIX");
    const cheapest = Math.min(...offers.map((x) => x.totalAmount));
    expect(cheapest).toBeGreaterThan(700);
    expect(cheapest).toBeLessThan(2500);
  });

  it("is deterministic for the same seed and tick", async () => {
    const { flights } = setup({ clock });
    const m = makeMission();
    const req = { ...buildSearchRequest(m), demo: { seed: m.id, tick: 3 } };
    const a = await flights.search(req);
    const b = await flights.search(req);
    expect(a.map((o) => o.totalAmount)).toEqual(b.map((o) => o.totalAmount));
  });
});

describe("selection", () => {
  it("never selects an itinerary violating a mandatory constraint", async () => {
    const { flights } = setup({ clock });
    const m = makeMission({ preferences: { ...makeMission().preferences, cabin: "economy", outboundTimeWindow: "morning", maxStops: 2 } });
    const offers = await flights.search({ ...buildSearchRequest(m), demo: { seed: m.id, tick: 0 } });
    const ranked = rankOffers(offers.map((o) => evaluateOffer(o, m)), m);
    for (const e of ranked) {
      const h = parseInt(e.offer.slices[0].departureAt.slice(11, 13), 10);
      expect(h).toBeGreaterThanOrEqual(5);
      expect(h).toBeLessThan(12);
      expect(e.violations).toEqual([]);
    }
  });

  it("adds the cost of required bags and ranks by lowest payable total", async () => {
    const { flights } = setup({ clock });
    const m = makeMission();
    const offers = await flights.search({ ...buildSearchRequest(m), demo: { seed: m.id, tick: 0 } });
    const evaluated = offers.map((o) => evaluateOffer(o, m));
    const light = evaluated.find((e) => e.offer.includedCheckedBagsPerPassenger === 0)!;
    expect(light.requiredBagCost).toBeGreaterThan(0);
    expect(light.payableTotal).toBeCloseTo(light.offer.totalAmount + light.requiredBagCost, 2);
    const ranked = rankOffers(evaluated, m);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i].payableTotal).toBeGreaterThanOrEqual(ranked[i - 1].payableTotal);
  });

  it("rejects offers in a different currency", async () => {
    const { flights } = setup({ clock });
    const m = makeMission();
    const offers = await flights.search({ ...buildSearchRequest({ ...m, currency: "EUR" }), demo: { seed: m.id, tick: 0 } });
    expect(evaluateOffer(offers[0], m).eligible).toBe(false);
  });
});

describe("booking engine", () => {
  it("monitors without buying while the price is above target", async () => {
    const { db, deps } = setup({ clock });
    db.missions.push(makeMission({ targetPrice: 300, maximumAuthorizedAmount: 300 }));
    const r = await runMissionCycle("mission-1", deps);
    expect(r.action).toBe("checked");
    expect(db.observations).toHaveLength(1);
    expect(db.attempts).toHaveLength(0);
    expect(db.missions[0].checkCount).toBe(1);
  });

  it("books when a flash sale reaches the target and records a confirmed booking", async () => {
    const { db, deps } = setup({ clock });
    db.missions.push(makeMission({ demoControls: { flashSaleAmount: 950 } }));
    const r = await runMissionCycle("mission-1", deps);
    expect(r.action).toBe("booked");
    expect(db.bookings).toHaveLength(1);
    expect(db.bookings[0].totalPaid).toBeLessThanOrEqual(1000);
    expect(db.bookings[0].mode).toBe("demo");
    expect(db.missions[0].monitoringStatus).toBe("booked");
    expect(db.attempts[0].status).toBe("confirmed");
    expect(db.notifications.some((n) => n.kind === "booking_confirmed")).toBe(true);
  });

  it("waits for approval when automatic purchase is off", async () => {
    const { db, deps } = setup({ clock });
    db.missions.push(makeMission({ demoControls: { flashSaleAmount: 950 } }, false));
    const r = await runMissionCycle("mission-1", deps);
    expect(r.action).toBe("target_reached");
    expect(db.bookings).toHaveLength(0);
    expect(db.missions[0].monitoringStatus).toBe("target_reached");
  });

  it("does not purchase if the price rises above the authorized limit at revalidation", async () => {
    const { db, deps } = setup({ clock });
    db.missions.push(makeMission({ demoControls: { flashSaleAmount: 950, nextOutcome: "price_jump" } }));
    const r = await runMissionCycle("mission-1", deps);
    expect(r.action).toBe("checked");
    expect(db.bookings).toHaveLength(0);
    expect(db.attempts[0].status).toBe("aborted");
    expect(db.missions[0].monitoringStatus).toBe("monitoring");
  });

  it("aborts cleanly when the offer disappears", async () => {
    const { db, deps } = setup({ clock });
    db.missions.push(makeMission({ demoControls: { flashSaleAmount: 950, nextOutcome: "offer_gone" } }));
    await runMissionCycle("mission-1", deps);
    expect(db.bookings).toHaveLength(0);
    expect(db.notifications.some((n) => n.kind === "offer_unavailable")).toBe(true);
  });

  it("requires action after a payment decline", async () => {
    const { db, deps } = setup({ clock });
    db.missions.push(makeMission({ demoControls: { flashSaleAmount: 950, nextOutcome: "payment_declined" } }));
    const r = await runMissionCycle("mission-1", deps);
    expect(r.action).toBe("action_required");
    expect(db.missions[0].monitoringStatus).toBe("action_required");
    expect(db.bookings).toHaveLength(0);
  });

  it("reconciles a timed-out order instead of resubmitting, then confirms", async () => {
    const { db, deps, flights } = setup({ clock });
    db.missions.push(makeMission({ demoControls: { flashSaleAmount: 950, nextOutcome: "timeout_then_confirmed" } }));
    let createCalls = 0;
    const original = flights.createOrder.bind(flights);
    flights.createOrder = async (input) => {
      createCalls++;
      return original(input);
    };
    const first = await runMissionCycle("mission-1", deps);
    expect(first.action).toBe("uncertain");
    expect(db.attempts[0].status).toBe("unknown");
    expect(db.missions[0].monitoringStatus).toBe("booking_in_progress");
    expect(db.bookings).toHaveLength(0);

    const second = await runMissionCycle("mission-1", deps);
    expect(second.action).toBe("booked");
    expect(createCalls).toBe(1);
    expect(db.bookings).toHaveLength(1);
  });

  it("reconciles a timed-out order that failed and resumes monitoring", async () => {
    const { db, deps } = setup({ clock });
    db.missions.push(makeMission({ demoControls: { flashSaleAmount: 950, nextOutcome: "timeout_then_failed" } }));
    await runMissionCycle("mission-1", deps);
    await runMissionCycle("mission-1", deps);
    expect(db.attempts[0].status).toBe("failed");
    expect(db.bookings).toHaveLength(0);
    expect(["monitoring", "booking_in_progress"]).toContain(db.missions[0].monitoringStatus);
  });

  it("prevents concurrent bookings of the same mission", async () => {
    const { db, deps, store } = setup({ clock });
    db.missions.push(makeMission({ demoControls: { flashSaleAmount: 950 } }));
    await store.acquireLock("mission-1", "someone-else", 300);
    const r = await runMissionCycle("mission-1", deps);
    expect(r.action).toBe("locked");
    expect(db.bookings).toHaveLength(0);
  });

  it("asks for re-authorization after a material edit", async () => {
    const { db, deps } = setup({ clock });
    const m = makeMission({ demoControls: { flashSaleAmount: 950 } });
    m.preferences.cabin = "economy";
    m.departureDate = "2026-12-24"; // changed after authorization
    db.missions.push(m);
    const r = await runMissionCycle("mission-1", deps);
    expect(r.action).toBe("action_required");
    expect(db.bookings).toHaveLength(0);
  });

  it("pays from reserved wallet funds and debits the ledger", async () => {
    const { db, deps, store } = setup({ clock });
    db.paymentMethods.push({
      id: "pm-wallet",
      userId: "user-1",
      mode: "demo",
      paymentType: "stablecoin_wallet",
      label: "USDC on Base",
      provider: "demo-wallet",
      providerReference: null,
      tokenOrWalletReference: "w1",
      currency: "USD",
      authorizationStatus: "active",
      card: null,
      wallet: { token: "USDC", network: "base", depositAddress: "DEMO", tokenContract: "0x", requiredConfirmations: 12 },
      confirmedBalance: null,
      createdAt: "",
    });
    db.walletTransactions.push({
      id: "tx1", paymentMethodId: "pm-wallet", userId: "user-1", direction: "deposit", amount: 1200, token: "USDC", network: "base",
      txHash: "0x1", confirmations: 12, requiredConfirmations: 12, status: "confirmed", createdAt: "",
    });
    db.reservations.push({ id: "res1", paymentMethodId: "pm-wallet", missionId: "mission-1", userId: "user-1", amount: 1000, status: "held", capturedAmount: 0, createdAt: "", updatedAt: "" });
    db.missions.push(makeMission({ paymentMethodId: "pm-wallet", demoControls: { flashSaleAmount: 950 } }));
    const r = await runMissionCycle("mission-1", deps);
    expect(r.action).toBe("booked");
    expect(store.walletBalance("pm-wallet")).toBeCloseTo(1200 - db.bookings[0].totalPaid, 2);
    expect(db.reservations[0].status).toBe("captured");
  });

  it("expires missions whose departure date has passed", async () => {
    const { db, deps } = setup({ clock: () => new Date("2026-12-26T00:00:00Z") });
    db.missions.push(makeMission());
    const r = await runMissionCycle("mission-1", deps);
    expect(r.action).toBe("expired");
    expect(db.missions[0].monitoringStatus).toBe("expired");
  });

  it("issues pending tickets on a later status poll", async () => {
    const { db, deps } = setup({ clock });
    db.missions.push(makeMission({ demoControls: { flashSaleAmount: 950, nextOutcome: "pending_ticketing" } }));
    await runMissionCycle("mission-1", deps);
    expect(db.bookings[0].ticketingStatus).toBe("pending");
    await runMissionCycle("mission-1", deps);
    expect(db.bookings[0].ticketingStatus).toBe("issued");
  });
});
