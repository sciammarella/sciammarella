import { describe, expect, it } from "vitest";
import { dedupe, DEFAULT_THRESHOLDS, evaluateRules, type MonitorAssetState, type MonitorContext } from "@/domain/alerts";
import { classifyFreshness, isTradingDay } from "@/domain/calendar";
import type { MacroSnapshot } from "@/domain/types";

const macro: MacroSnapshot = { cdi: 0.149, selic: 0.15, ipca12m: 0.048, usdbrl: 5.42, ust3m: 0.039, ust10y: 0.042, asOf: "2026-10-16", origin: { CDI: "real", USDBRL: "real", UST3M: "real" } };
const asset = (o: Partial<MonitorAssetState>): MonitorAssetState => ({
  assetId: "BR-BOVA11", symbol: "BOVA11", name: "BOVA11", assetClass: "etf", weight: 0.2, value: 20000, targetWeight: null, price: 100, priceDate: "2026-10-16",
  prevPrice: 100, prevPriceDate: "2026-10-15", prevSource: "last_run", status: "ok", origin: "real", sourceName: "x", riskScore: 5, prevRiskScore: 5,
  riskCategory: "moderado", prevRiskCategory: "moderado", recentVol: null, longVol: null, ...o,
});
const ctx = (assets: MonitorAssetState[], o: Partial<MonitorContext> = {}): MonitorContext => ({
  portfolioId: "p1", portfolioName: "P", baseCurrency: "BRL", totalValue: 100000,
  profile: { label: "Moderado", maxRiskScore: 5, maxDrawdown: 0.15, maxCryptoWeight: 0.03, objective: "growth" },
  portfolioRisk: 4, prevPortfolioRisk: 4, peakValue: null, macro: { current: macro, previous: macro }, events: [], fxExposure: 0.1, fixedIncomeWeight: 0.4,
  assets, analyzedAt: "2026-10-16T21:30:00Z", ...o,
});
const rules = (c: MonitorContext) => evaluateRules(c, DEFAULT_THRESHOLDS).map((a) => a.rule);

describe("alert rules", () => {
  it("ignores irrelevant moves below the threshold", () => {
    expect(rules(ctx([asset({ price: 102 })]))).toEqual([]);
  });
  it("fires a price alert with evidence and impact above the threshold", () => {
    const [a] = evaluateRules(ctx([asset({ price: 93 })]));
    expect(a.rule).toBe("price_move");
    expect(a.severity).toBe("attention");
    expect(a.impact.portfolioPct).toBeCloseTo(-0.014, 6);
    expect(a.evidence.map((e) => e.label)).toContain("Preço anterior");
    expect(a.whatChanged).toMatch(/-7\.0%/);
    expect(a.suggestedAction).toBeTruthy();
  });
  it("escalates big moves to critical and downgrades tiny positions to info", () => {
    expect(evaluateRules(ctx([asset({ price: 85 })]))[0].severity).toBe("critical");
    expect(evaluateRules(ctx([asset({ price: 93, weight: 0.01, value: 1000 })]))[0].severity).toBe("info");
  });
  it("uses class-specific thresholds (crypto tolerates more)", () => {
    expect(rules(ctx([asset({ assetClass: "crypto", price: 93, weight: 0.02 })]))).toEqual([]);
    expect(rules(ctx([asset({ assetClass: "crypto", price: 85, weight: 0.03 })]))).toContain("price_move");
  });
  it("never draws price conclusions from missing or stale data", () => {
    const r = evaluateRules(ctx([asset({ status: "source_unavailable", price: 50 })]));
    expect(r.map((a) => a.rule)).toEqual(["data_quality"]);
    expect(r[0].severity).toBe("info");
  });
  it("detects stablecoin depegs", () => {
    const r = evaluateRules(ctx([asset({ assetId: "CR-USDT", symbol: "USDT", assetClass: "stablecoin", price: 0.965, prevPrice: 1, peg: 1, weight: 0.02 })]));
    expect(r[0].rule).toBe("stablecoin_depeg");
    expect(r[0].severity).toBe("critical");
  });
  it("detects drift, concentration, risk change and volatility regime", () => {
    const r = rules(ctx([asset({ weight: 0.32, targetWeight: 0.2, prevRiskScore: 3, riskScore: 6, riskCategory: "moderado", recentVol: 0.4, longVol: 0.2 })]));
    expect(r).toEqual(expect.arrayContaining(["drift", "concentration", "risk_change", "volatility"]));
  });
  it("detects FX and rate changes only when the portfolio is exposed", () => {
    const prev = { ...macro, usdbrl: 5.0, cdi: 0.14 };
    expect(rules(ctx([asset({})], { macro: { current: macro, previous: prev }, fxExposure: 0.3 }))).toEqual(expect.arrayContaining(["fx", "rates_br"]));
    expect(rules(ctx([asset({})], { macro: { current: macro, previous: prev }, fxExposure: 0.02, fixedIncomeWeight: 0 }))).toEqual([]);
  });
  it("forwards credit events only for held assets", () => {
    const ev = { id: "e1", assetId: "BR-CDB-MED-115", type: "credit", severity: "critical" as const, title: "Rebaixamento", description: "x", occurredAt: "2026-10-16", isDemo: true, sourceName: "demo" };
    expect(rules(ctx([asset({})], { events: [ev] }))).toEqual([]);
    const r = evaluateRules(ctx([asset({ assetId: "BR-CDB-MED-115", assetClass: "bank_fixed_income" })], { events: [ev] }));
    expect(r[0].rule).toBe("event_credit");
    expect(r[0].evidence[0].isDemo).toBe(true);
  });
  it("flags portfolio risk above the profile and drawdown from peak", () => {
    expect(rules(ctx([asset({})], { portfolioRisk: 8, peakValue: 125000 }))).toEqual(expect.arrayContaining(["profile_mismatch", "drawdown"]));
  });
  it("respects the minimum severity preference", () => {
    const r = evaluateRules(ctx([asset({ price: 93, weight: 0.01 })]), { ...DEFAULT_THRESHOLDS, minSeverity: "attention" });
    expect(r).toEqual([]);
  });
});

describe("dedupe", () => {
  const c = evaluateRules(ctx([asset({ price: 93 })]))[0];
  const now = new Date("2026-10-17T00:00:00Z");
  it("suppresses repeats inside the cooldown", () => {
    const r = dedupe([c], [{ fingerprint: c.fingerprint, severity: "attention", lastSeenAt: "2026-10-16T12:00:00Z" }], now, 24);
    expect(r.create).toHaveLength(0);
    expect(r.repeated).toHaveLength(1);
  });
  it("re-emits after the cooldown or when severity escalates", () => {
    expect(dedupe([c], [{ fingerprint: c.fingerprint, severity: "attention", lastSeenAt: "2026-10-15T00:00:00Z" }], now, 24).create).toHaveLength(1);
    expect(dedupe([c], [{ fingerprint: c.fingerprint, severity: "info", lastSeenAt: "2026-10-16T23:00:00Z" }], now, 24).create).toHaveLength(1);
  });
});

describe("market calendar & freshness", () => {
  it("knows weekends and holidays", () => {
    expect(isTradingDay("2026-10-18", "BR")).toBe(false); // Sunday
    expect(isTradingDay("2026-11-20", "BR")).toBe(false); // Consciência Negra
    expect(isTradingDay("2026-11-26", "US")).toBe(false); // Thanksgiving
    expect(isTradingDay("2026-10-18", "GLOBAL")).toBe(true);
  });
  it("distinguishes no trading day, stale data, no data and source unavailable", () => {
    expect(classifyFreshness("2026-10-16", "2026-10-18", "BR", true)).toBe("no_trading_day");
    expect(classifyFreshness("2026-10-16", "2026-10-16", "BR", true)).toBe("ok");
    expect(classifyFreshness("2026-10-01", "2026-10-16", "BR", true)).toBe("stale");
    expect(classifyFreshness("2026-10-01", "2026-10-16", "BR", false)).toBe("source_unavailable");
    expect(classifyFreshness(null, "2026-10-16", "BR", true)).toBe("no_data");
  });
});
