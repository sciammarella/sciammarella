import { describe, expect, it } from "vitest";
import {
  annualizedVolatility, brRegressiveTaxRate, cagr, dailyPctToAnnual, hhi, historicalVaR, lognormalAnnualizedPercentile, maxDrawdown, normCdf, normInv,
  pearson, portfolioVolatility, probabilityOfLoss, simpleReturns,
} from "@/domain/finance";
import { fxConvert, priceAt, valuePosition } from "@/domain/valuation";
import { CATALOG_BY_ID } from "@/domain/catalog";
import type { MacroSnapshot } from "@/domain/types";

const macro: MacroSnapshot = { cdi: 0.15, selic: 0.15, ipca12m: 0.05, usdbrl: 5, ust3m: 0.04, ust10y: 0.042, asOf: "2026-10-16", origin: {} };

describe("finance math", () => {
  it("computes simple returns and CAGR", () => {
    const r = simpleReturns([100, 110, 99]);
    expect(r[0]).toBeCloseTo(0.1, 12);
    expect(r[1]).toBeCloseTo(-0.1, 12);
    expect(cagr(100, 121, 2)).toBeCloseTo(0.1, 10);
  });
  it("max drawdown is peak-to-trough", () => {
    expect(maxDrawdown([100, 120, 90, 130, 104])).toBeCloseTo(0.25, 10);
    expect(maxDrawdown([1, 2, 3])).toBe(0);
  });
  it("annualized volatility of a constant-growth series is ~0", () => {
    const p = Array.from({ length: 300 }, (_, i) => 100 * 1.001 ** i);
    expect(annualizedVolatility(p)).toBeLessThan(1e-9);
  });
  it("annualized volatility scales with sqrt(time)", () => {
    const p = [100];
    for (let i = 0; i < 500; i++) p.push(p[i] * Math.exp(i % 2 ? 0.01 : -0.01));
    expect(annualizedVolatility(p)).toBeCloseTo(0.01 * Math.sqrt(252), 2);
  });
  it("normal CDF and inverse are consistent", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.959964)).toBeCloseTo(0.975, 4);
    for (const p of [0.01, 0.1, 0.5, 0.9, 0.99]) expect(normCdf(normInv(p))).toBeCloseTo(p, 5);
  });
  it("lognormal scenarios are ordered and collapse with zero vol", () => {
    const lo = lognormalAnnualizedPercentile(0.1, 0.2, 3, 0.1);
    const hi = lognormalAnnualizedPercentile(0.1, 0.2, 3, 0.9);
    expect(lo).toBeLessThan(0.1);
    expect(hi).toBeGreaterThan(0.1);
    expect(lognormalAnnualizedPercentile(0.08, 0, 2, 0.1)).toBeCloseTo(0.08, 8);
  });
  it("probability of loss decreases with horizon for positive drift", () => {
    const p1 = probabilityOfLoss(0.1, 0.2, 1);
    const p5 = probabilityOfLoss(0.1, 0.2, 5);
    expect(p1).toBeGreaterThan(p5);
    expect(p1).toBeGreaterThan(0.2);
    expect(p1).toBeLessThan(0.4);
  });
  it("converts BCB daily CDI to annual (252 business days)", () => {
    expect(dailyPctToAnnual(0.055131)).toBeCloseTo(0.149, 3);
  });
  it("applies the Brazilian regressive income tax table", () => {
    expect(brRegressiveTaxRate(100)).toBe(0.225);
    expect(brRegressiveTaxRate(300)).toBe(0.2);
    expect(brRegressiveTaxRate(700)).toBe(0.175);
    expect(brRegressiveTaxRate(721)).toBe(0.15);
  });
  it("HHI, correlation, VaR and portfolio volatility", () => {
    expect(hhi([0.5, 0.5])).toBeCloseTo(0.5);
    expect(hhi([1])).toBe(1);
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
    const r = Array.from({ length: 100 }, (_, i) => (i - 50) / 1000);
    expect(historicalVaR(r, 0.95)).toBeCloseTo(0.045, 3);
    const v = portfolioVolatility([0.5, 0.5], [0.2, 0.2], [[1, 0], [0, 1]]);
    expect(v).toBeCloseTo(Math.sqrt(0.02), 10);
    expect(portfolioVolatility([0.5, 0.5], [0.2, 0.2], [[1, 1], [1, 1]])).toBeCloseTo(0.2, 10);
  });
});

describe("valuation", () => {
  it("converts currencies through USD/BRL", () => {
    expect(fxConvert(100, "USD", "BRL", 5)).toBe(500);
    expect(fxConvert(500, "BRL", "USD", 5)).toBe(100);
    expect(fxConvert(1, "BRL", "BRL", 5)).toBe(1);
  });
  it("finds the last price on or before a date", () => {
    const s = [{ date: "2026-01-02", close: 1 }, { date: "2026-01-05", close: 2 }];
    expect(priceAt(s, "2026-01-01")).toBeNull();
    expect(priceAt(s, "2026-01-04")).toBe(1);
    expect(priceAt(s, "2026-02-01")).toBe(2);
  });
  it("values quoted positions at market and accrual positions by contract (estimated)", () => {
    const voo = CATALOG_BY_ID.get("US-VOO")!;
    const q = valuePosition(voo, { quantity: 2, avgPrice: 400, acquiredAt: "2026-01-01", manualValue: null }, [{ date: "2026-10-16", close: 500 }], "demo", macro, "BRL", "2026-10-18");
    expect(q.valueBase).toBe(5000);
    expect(q.valuation).toBe("market_demo");
    expect(q.costBase).toBe(4000);
    const cdb = CATALOG_BY_ID.get("BR-CDB-LIQ-100")!;
    const a = valuePosition(cdb, { quantity: 1000, avgPrice: 1, acquiredAt: "2025-10-18", manualValue: null }, [], "real", macro, "BRL", "2026-10-18");
    expect(a.valuation).toBe("estimated");
    expect(a.valueBase).toBeCloseTo(1150, 0);
    const m = valuePosition(cdb, { quantity: 1000, avgPrice: 1, acquiredAt: "2025-10-18", manualValue: 1234 }, [], "real", macro, "BRL", "2026-10-18");
    expect(m.valuation).toBe("manual_value");
    expect(m.valueBase).toBe(1234);
  });
});
