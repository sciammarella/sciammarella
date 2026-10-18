// Deterministic financial math. No I/O, no randomness. Unit-tested in tests/finance.test.ts.

import type { PricePoint } from "./types";

export const TRADING_DAYS = 252;

export function round(n: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function simpleReturns(prices: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) out.push(prices[i] / prices[i - 1] - 1);
  }
  return out;
}

export function logReturns(prices: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0 && prices[i] > 0) out.push(Math.log(prices[i] / prices[i - 1]));
  }
  return out;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (n-1). */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  const v = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

/** Annualized volatility from periodic log returns. */
export function annualizedVolatility(prices: number[], periodsPerYear = TRADING_DAYS): number {
  const r = logReturns(prices);
  if (r.length < 2) return NaN;
  return stdev(r) * Math.sqrt(periodsPerYear);
}

/** Compound annual growth rate between first and last observation. */
export function cagr(startValue: number, endValue: number, years: number): number {
  if (startValue <= 0 || years <= 0) return NaN;
  return (endValue / startValue) ** (1 / years) - 1;
}

export function yearsBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / (365.25 * 86400000);
}

/** Maximum peak-to-trough decline, returned as a positive fraction (0.35 = -35%). */
export function maxDrawdown(prices: number[]): number {
  let peak = -Infinity;
  let mdd = 0;
  for (const p of prices) {
    if (p > peak) peak = p;
    if (peak > 0) mdd = Math.max(mdd, 1 - p / peak);
  }
  return mdd;
}

export function currentDrawdown(prices: number[]): number {
  if (prices.length === 0) return 0;
  const peak = Math.max(...prices);
  return peak > 0 ? 1 - prices[prices.length - 1] / peak : 0;
}

/** Historical Value-at-Risk (positive number = loss) at the given confidence. */
export function historicalVaR(returns: number[], confidence = 0.95): number {
  if (returns.length < 20) return NaN;
  const sorted = [...returns].sort((a, b) => a - b);
  const idx = Math.floor((1 - confidence) * sorted.length);
  return -sorted[Math.max(0, idx)];
}

export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  const x = a.slice(-n);
  const y = b.slice(-n);
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return NaN;
  return num / Math.sqrt(dx * dy);
}

/** Align two price series by date and return their log returns over common dates. */
export function alignedReturns(a: PricePoint[], b: PricePoint[]): [number[], number[]] {
  const mapB = new Map(b.map((p) => [p.date, p.close]));
  const common = a.filter((p) => mapB.has(p.date));
  const pa = common.map((p) => p.close);
  const pb = common.map((p) => mapB.get(p.date)!);
  return [logReturns(pa), logReturns(pb)];
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
export function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

/** Inverse standard normal CDF (Acklam's rational approximation). */
export function normInv(p: number): number {
  if (p <= 0 || p >= 1) throw new Error("p fora de (0,1)");
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Lognormal scenario for an asset with expected arithmetic annual return `mu`
 * and annual volatility `sigma` held for `years`. Returns the annualized return
 * at the given percentile.
 */
export function lognormalAnnualizedPercentile(mu: number, sigma: number, years: number, percentile: number): number {
  const m = Math.log(1 + mu) - (sigma * sigma) / 2;
  const z = normInv(percentile);
  const cumulative = Math.exp(m * years + z * sigma * Math.sqrt(years));
  return cumulative ** (1 / years) - 1;
}

/** Probability that the cumulative return over `years` is negative under a lognormal model. */
export function probabilityOfLoss(mu: number, sigma: number, years: number): number {
  if (sigma <= 0) return mu < 0 ? 1 : 0;
  const m = Math.log(1 + mu) - (sigma * sigma) / 2;
  return normCdf(-(m * years) / (sigma * Math.sqrt(years)));
}

/** Convert a daily rate in percent (BCB SGS series 12 format) to an annual fraction (252 d.u.). */
export function dailyPctToAnnual(dailyPct: number): number {
  return (1 + dailyPct / 100) ** TRADING_DAYS - 1;
}

/** Combine two return sources multiplicatively: (1+a)(1+b)-1. */
export function compound(a: number, b: number): number {
  return (1 + a) * (1 + b) - 1;
}

/** Brazilian regressive income tax rate on fixed income by holding period in days. */
export function brRegressiveTaxRate(days: number): number {
  if (days <= 180) return 0.225;
  if (days <= 360) return 0.2;
  if (days <= 720) return 0.175;
  return 0.15;
}

/** Herfindahl–Hirschman index (0..1) for a set of weights. */
export function hhi(weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  return weights.reduce((a, w) => a + (w / total) ** 2, 0);
}

/** Portfolio volatility from weights, vols and a correlation matrix. */
export function portfolioVolatility(weights: number[], vols: number[], corr: number[][]): number {
  let v = 0;
  for (let i = 0; i < weights.length; i++) {
    for (let j = 0; j < weights.length; j++) {
      v += weights[i] * weights[j] * vols[i] * vols[j] * corr[i][j];
    }
  }
  return Math.sqrt(Math.max(v, 0));
}

/** Value grown by an annual rate over a fractional number of years. */
export function accrue(principal: number, annualRate: number, years: number): number {
  return principal * (1 + annualRate) ** Math.max(0, years);
}
