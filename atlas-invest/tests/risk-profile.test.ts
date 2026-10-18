import { describe, expect, it } from "vitest";
import { analyzeAsset, type AssetMarketData } from "@/domain/analytics";
import { CATALOG, CATALOG_BY_ID } from "@/domain/catalog";
import { generateDemoSeries } from "@/domain/demo-market";
import { evaluateOpportunity } from "@/domain/discovery";
import { deriveProfile } from "@/domain/profile";
import { aggregate, assessAssetRisk, categoryFromScore } from "@/domain/risk";
import type { MacroSnapshot, ProfileAnswers } from "@/domain/types";

const macro: MacroSnapshot = { cdi: 0.149, selic: 0.15, ipca12m: 0.048, usdbrl: 5.42, ust3m: 0.039, ust10y: 0.042, asOf: "2026-10-16", origin: {} };
const md = (id: string): AssetMarketData => {
  const s = CATALOG_BY_ID.get(id)!;
  return { prices: s.pricing === "quoted" ? generateDemoSeries(s, "2023-10-18", "2026-10-16") : [], origin: "demo", sourceName: "demo", lastUpdated: null, status: "ok" };
};
const analyze = (id: string, base: "BRL" | "USD" = "BRL", h = 4) => analyzeAsset(CATALOG_BY_ID.get(id)!, md(id), macro, base, h);

const answers: ProfileAnswers = {
  residenceCountry: "BR", baseCurrency: "BRL", amount: 100000, objective: "growth", targetReturn: 0.12, horizon: "3to5", lossTolerance: "moderate",
  liquidityNeed: "monthly", markets: ["BR", "US"], allowedClasses: [], excludedClasses: [], experience: "intermediate", cryptoExperience: "basic",
};

describe("risk engine", () => {
  it("maps scores to five categories", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(categoryFromScore)).toEqual(["muito_baixo", "muito_baixo", "baixo", "baixo", "moderado", "moderado", "alto", "alto", "muito_alto", "muito_alto"]);
  });
  it("weakest-link floor: one severe component cannot be averaged away", () => {
    const r = aggregate([
      { key: "market", score: 1, rationale: "" }, { key: "credit", score: 10, rationale: "" }, { key: "liquidity", score: 1, rationale: "" },
      { key: "fx", score: 1, rationale: "" }, { key: "counterparty", score: 1, rationale: "" },
    ], []);
    expect(r.score).toBeGreaterThanOrEqual(8);
    expect(r.explanation).toMatch(/elevada pelo componente mais severo/);
  });
  it("ranks treasury Selic far below Bitcoin and a tokenized receivable above a FGC-covered CDB", () => {
    const selic = analyze("BR-TD-SELIC-2029").risk.score;
    const btc = analyze("CR-BTC").risk.score;
    expect(selic).toBeLessThanOrEqual(3);
    expect(btc).toBeGreaterThanOrEqual(8);
    expect(analyze("BR-RWA-RECEB").risk.score).toBeGreaterThan(analyze("BR-CDB-LIQ-100").risk.score);
  });
  it("does not rely only on volatility: low-vol credit still carries credit risk", () => {
    const tkn = analyze("BR-RWA-RECEB");
    const credit = tkn.risk.components.find((c) => c.key === "credit")!;
    expect(credit.score).toBeGreaterThanOrEqual(7);
    expect(tkn.risk.components.find((c) => c.key === "technology")!.score).not.toBeNull();
  });
  it("FX risk depends on the investor's base currency", () => {
    const fx = (base: "BRL" | "USD") => assessAssetRisk({ spec: CATALOG_BY_ID.get("US-VOO")!, baseCurrency: base, volatility: 0.17, maxDrawdown: 0.25, observations: 700, isDemoData: false }).components.find((c) => c.key === "fx")!.score;
    expect(fx("BRL")).toBeGreaterThan(fx("USD")!);
  });
  it("flags demo data and short history as limitations", () => {
    const r = assessAssetRisk({ spec: CATALOG_BY_ID.get("BR-PETR4")!, baseCurrency: "BRL", volatility: 0.3, maxDrawdown: 0.3, observations: 100, isDemoData: true });
    expect(r.limitations.join(" ")).toMatch(/DEMONSTRAÇÃO/);
    expect(r.limitations.join(" ")).toMatch(/Histórico curto/);
  });
  it("every catalog asset gets a valid assessment and ordered scenarios", () => {
    for (const s of CATALOG) {
      const a = analyze(s.id);
      expect(a.risk.score).toBeGreaterThanOrEqual(1);
      expect(a.risk.score).toBeLessThanOrEqual(10);
      const sc = a.expected!.scenarios;
      expect(sc.pessimistic).toBeLessThanOrEqual(sc.base + 1e-9);
      expect(sc.optimistic).toBeGreaterThanOrEqual(sc.base - 1e-9);
    }
  });
  it("assumes no positive risk premium for crypto", () => {
    const btcUsd = analyze("CR-BTC", "USD");
    expect(btcUsd.expected!.scenarios.base).toBeCloseTo(macro.ust3m - CATALOG_BY_ID.get("CR-BTC")!.feesAnnual, 6);
  });
  it("reports insufficient data instead of inventing a loss probability", () => {
    const spec = CATALOG_BY_ID.get("US-NVDA")!;
    const a = analyzeAsset(spec, { prices: generateDemoSeries(spec, "2026-08-01", "2026-10-16"), origin: "demo", sourceName: "demo", lastUpdated: null, status: "ok" }, macro, "BRL", 4);
    expect(a.expected!.probabilityOfLoss).toBeNull();
    expect(a.expected!.probabilityOfLossNote).toMatch(/Dados insuficientes/);
  });
});

describe("profile", () => {
  it("a high target never raises the risk level", () => {
    const low = deriveProfile({ ...answers, targetReturn: 0.08 });
    const high = deriveProfile({ ...answers, targetReturn: 1.0 });
    expect(high.level).toBe(low.level);
    expect(high.explanation.join(" ")).toMatch(/não foi usada para aumentar/);
  });
  it("takes the minimum of tolerance and capacity", () => {
    expect(deriveProfile({ ...answers, lossTolerance: "very_high", horizon: "lt1" }).level).toBe(1);
    expect(deriveProfile({ ...answers, lossTolerance: "very_high", horizon: "gt5", liquidityNeed: "none", experience: "advanced", objective: "high_growth" }).level).toBe(4);
    expect(deriveProfile({ ...answers, lossTolerance: "very_high", horizon: "gt5", liquidityNeed: "none", experience: "none", objective: "high_growth" }).level).toBe(2);
  });
  it("caps crypto for users without crypto experience and when excluded", () => {
    const p = deriveProfile({ ...answers, lossTolerance: "very_high", horizon: "gt5", liquidityNeed: "none", objective: "high_growth", cryptoExperience: "none" });
    expect(p.maxCryptoWeight).toBe(0.02);
    expect(deriveProfile({ ...answers, excludedClasses: ["crypto"] }).maxCryptoWeight).toBe(0);
  });
});

describe("discovery eligibility", () => {
  it("excludes BR-only products for US residents and qualified-only products for retail", () => {
    const us = { ...answers, residenceCountry: "US" as const, baseCurrency: "USD" as const };
    const p = deriveProfile(us);
    const selic = evaluateOpportunity(CATALOG_BY_ID.get("BR-TD-SELIC-2029")!, analyze("BR-TD-SELIC-2029", "USD"), us, p);
    expect(selic.eligible).toBe(false);
    const rwa = evaluateOpportunity(CATALOG_BY_ID.get("US-RWA-TBILL")!, analyze("US-RWA-TBILL"), answers, deriveProfile(answers));
    expect(rwa.eligible).toBe(false);
    expect(rwa.eligibilityIssues.join(" ")).toMatch(/qualificados/);
  });
  it("marks crypto incompatible for a conservative profile", () => {
    const cons = { ...answers, lossTolerance: "low" as const };
    const op = evaluateOpportunity(CATALOG_BY_ID.get("CR-BTC")!, analyze("CR-BTC"), cons, deriveProfile(cons));
    expect(op.compatibility).toBe("incompatível");
  });
});
