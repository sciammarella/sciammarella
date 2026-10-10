import { describe, expect, it } from "vitest";
import { defaultPreferences } from "@engine/mission.ts";
import { activateMission, addDemoWallet, cancelMission, type MissionInput, saveMission, simulateDeposit, progressDemoDeposits } from "@engine/service.ts";
import { generatePassengerKey, importPassengerKey, encryptPassenger, decryptPassenger } from "@engine/passengerCrypto.ts";
import { setup, USER } from "./helpers.ts";

const NOW = "2026-10-10T12:00:00.000Z";

function input(over: Partial<MissionInput> = {}): MissionInput {
  return {
    originCode: "VIX",
    destinationCode: "TYO",
    departureDate: "2026-12-25",
    returnDate: "2027-01-12",
    passengerProfileIds: ["pax-1"],
    preferences: defaultPreferences(),
    targetPrice: 1000,
    maximumAuthorizedAmount: 1000,
    priceTolerance: 0,
    currency: "USD",
    paymentMethodId: "pm-card",
    monitoringIntervalMinutes: 60,
    ...over,
  };
}

describe("mission service", () => {
  it("revokes authorization when a material condition changes", async () => {
    const { store } = setup();
    const { mission } = await saveMission(store, USER, "demo", input(), NOW);
    await activateMission(store, USER, mission.id, { autoPurchase: true, consent: true }, NOW);
    const nonMaterial = await saveMission(store, USER, "demo", { ...input({ targetPrice: 900 }), id: mission.id }, NOW);
    expect(nonMaterial.materialChanges).toEqual([]);
    const material = await saveMission(store, USER, "demo", { ...input({ targetPrice: 900, departureDate: "2026-12-24" }), id: mission.id }, NOW);
    expect(material.materialChanges).toContain("Departure date");
    expect(material.mission.purchaseAuthorization?.revokedAt).toBeTruthy();
    expect(material.mission.monitoringStatus).toBe("action_required");
  });

  it("requires consent and rejects raising the ceiling without re-authorization", async () => {
    const { store } = setup();
    const { mission } = await saveMission(store, USER, "demo", input(), NOW);
    await expect(activateMission(store, USER, mission.id, { autoPurchase: true, consent: false }, NOW)).rejects.toThrow(/consent/);
    await activateMission(store, USER, mission.id, { autoPurchase: true, consent: true }, NOW);
    const r = await saveMission(store, USER, "demo", { ...input({ maximumAuthorizedAmount: 1500 }), id: mission.id }, NOW);
    expect(r.materialChanges).toContain("Maximum authorized amount increased");
  });

  it("never lets one wallet balance back two missions, and ignores pending deposits", async () => {
    const { store } = setup();
    const wallet = await addDemoWallet(store, USER, "USDC", "base", NOW);
    await simulateDeposit(store, USER, wallet.id, 1500, NOW);
    const a = (await saveMission(store, USER, "demo", input({ paymentMethodId: wallet.id }), NOW)).mission;
    // Pending deposit: not spendable yet.
    await expect(activateMission(store, USER, a.id, { autoPurchase: true, consent: true }, NOW)).rejects.toThrow(/cannot be activated/);
    await progressDemoDeposits(store, "2026-10-10T12:05:00.000Z");
    await activateMission(store, USER, a.id, { autoPurchase: true, consent: true }, NOW);
    const b = (await saveMission(store, USER, "demo", input({ paymentMethodId: wallet.id }), NOW)).mission;
    await expect(activateMission(store, USER, b.id, { autoPurchase: true, consent: true }, NOW)).rejects.toThrow(/cannot be activated/);
    await cancelMission(store, USER, a.id, NOW);
    await activateMission(store, USER, b.id, { autoPurchase: true, consent: true }, NOW);
  });

  it("refuses to activate a mission whose passport expires before the trip ends", async () => {
    const { store, db } = setup();
    const original = (store as unknown as { opts: { decryptPassenger: (r: unknown) => Promise<object> } }).opts.decryptPassenger;
    (store as unknown as { opts: { decryptPassenger: unknown } }).opts.decryptPassenger = async (r: unknown) => ({ ...(await original(r)), passportExpiry: "2027-01-05" });
    void db;
    const { mission } = await saveMission(store, USER, "demo", input(), NOW);
    await expect(activateMission(store, USER, mission.id, { autoPurchase: true, consent: true }, NOW)).rejects.toThrow(/cannot be activated/);
  });
});

describe("passenger encryption", () => {
  it("round-trips and binds ciphertext to its owner", async () => {
    const key = await importPassengerKey(generatePassengerKey());
    const details = { id: "p1", fullLegalName: "Ana Souza", passportNumber: "FX123456" } as never;
    const blob = await encryptPassenger(key, details, "user-1:p1");
    expect(blob).not.toContain("FX123456");
    expect((await decryptPassenger(key, blob, "user-1:p1")).passportNumber).toBe("FX123456");
    await expect(decryptPassenger(key, blob, "user-2:p1")).rejects.toThrow();
  });
});
