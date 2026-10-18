// Position valuation and simulated history of the current composition.

import { contractualYield } from "./analytics";
import { addDays } from "./calendar";
import { yearsBetween } from "./finance";
import type { AssetSpec, Currency, DataOrigin, MacroSnapshot, PricePoint } from "./types";

export interface PositionInput {
  quantity: number;
  avgPrice: number;
  acquiredAt: string;
  manualValue: number | null;
}

export type Valuation = "market_real" | "market_demo" | "estimated" | "manual_value";

export function fxConvert(amount: number, from: Currency, to: Currency, usdbrl: number): number {
  if (from === to) return amount;
  return from === "USD" ? amount * usdbrl : amount / usdbrl;
}

export function accrualRate(spec: AssetSpec, macro: MacroSnapshot): number {
  return (contractualYield(spec, macro) ?? 0) - spec.feesAnnual;
}

export function valuePosition(
  spec: AssetSpec,
  pos: PositionInput,
  prices: PricePoint[],
  origin: DataOrigin | null,
  macro: MacroSnapshot,
  base: Currency,
  today: string,
): { valueLocal: number; valueBase: number; valuation: Valuation; price: number | null; priceDate: string | null; costBase: number } {
  const costLocal = pos.quantity * pos.avgPrice;
  const costBase = fxConvert(costLocal, spec.currency, base, macro.usdbrl);
  let valueLocal: number;
  let valuation: Valuation;
  let price: number | null = null;
  let priceDate: string | null = null;
  if (pos.manualValue != null) {
    valueLocal = pos.manualValue;
    valuation = "manual_value";
  } else if (spec.pricing === "accrual") {
    const years = Math.max(0, yearsBetween(pos.acquiredAt, today));
    valueLocal = costLocal * (1 + accrualRate(spec, macro)) ** years;
    valuation = "estimated";
    price = pos.quantity > 0 ? valueLocal / pos.quantity : null;
    priceDate = today;
  } else {
    const last = prices[prices.length - 1];
    if (last) {
      valueLocal = pos.quantity * last.close;
      price = last.close;
      priceDate = last.date;
      valuation = origin === "real" ? "market_real" : "market_demo";
    } else {
      valueLocal = costLocal;
      valuation = "estimated";
    }
  }
  return { valueLocal, valueBase: fxConvert(valueLocal, spec.currency, base, macro.usdbrl), valuation, price, priceDate, costBase };
}

/** Last close on or before `date` using a pre-sorted series (binary search). */
export function priceAt(series: PricePoint[], date: string): number | null {
  let lo = 0;
  let hi = series.length - 1;
  let ans: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].date <= date) {
      ans = series[mid].close;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export interface HistoryHolding {
  spec: AssetSpec;
  pos: PositionInput;
  prices: PricePoint[];
}

export interface HistoryPoint {
  date: string;
  value: number;
  cdi: number;
  [benchmark: string]: number | string;
}

/**
 * Simulated value of the CURRENT composition over the last `days` days
 * (constant quantities, constant FX). It is not a realized return.
 */
export function simulateHistory(holdings: HistoryHolding[], macro: MacroSnapshot, base: Currency, today: string, days: number, benchmarks: Record<string, PricePoint[]>): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  const start = addDays(today, -days);
  const step = days > 400 ? 7 : 1;
  const bmStart: Record<string, number | null> = {};
  for (const [k, s] of Object.entries(benchmarks)) bmStart[k] = priceAt(s, start) ?? s[0]?.close ?? null;
  let firstValue: number | null = null;
  for (let d = start; d <= today; d = addDays(d, step)) {
    let v = 0;
    for (const h of holdings) {
      let local: number;
      if (h.pos.manualValue != null) local = h.pos.manualValue;
      else if (h.spec.pricing === "accrual") local = h.pos.quantity * h.pos.avgPrice * (1 + accrualRate(h.spec, macro)) ** yearsBetween(h.pos.acquiredAt, d);
      else local = h.pos.quantity * (priceAt(h.prices, d) ?? h.pos.avgPrice);
      v += fxConvert(local, h.spec.currency, base, macro.usdbrl);
    }
    if (firstValue == null) firstValue = v;
    const point: HistoryPoint = { date: d, value: v, cdi: 100 * (1 + (base === "BRL" ? macro.cdi : macro.ust3m)) ** yearsBetween(start, d) };
    point.portfolio = firstValue ? (100 * v) / firstValue : 100;
    for (const [k, s] of Object.entries(benchmarks)) {
      const p = priceAt(s, d);
      const b0 = bmStart[k];
      if (p != null && b0) point[k] = (100 * p) / b0;
    }
    out.push(point);
  }
  return out;
}

export function changeOver(history: HistoryPoint[], days: number): number | null {
  if (history.length < 2) return null;
  const last = history[history.length - 1];
  const target = addDays(last.date, -days);
  const ref = [...history].reverse().find((p) => p.date <= target);
  if (!ref || ref.value <= 0) return null;
  return last.value / ref.value - 1;
}
