// Deterministic demo market generator. Every value produced here is SIMULATED and
// is stored with is_demo = true. The same (asset, date) always yields the same
// daily return, so the demo series is reproducible across machines.

import { addDays, isTradingDay } from "./calendar";
import type { AssetSpec, PricePoint } from "./types";

/** 32-bit FNV-1a hash → seed. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic standard normal draw for a key. */
function gaussian(key: string): number {
  const rnd = mulberry32(hash(key));
  const u = Math.max(rnd(), 1e-12);
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function uniform(key: string): number {
  return mulberry32(hash(key))();
}

export function demoMarketOf(spec: AssetSpec): "BR" | "US" | "GLOBAL" {
  return spec.assetClass === "crypto" || spec.assetClass === "stablecoin" || spec.market === "GLOBAL" ? "GLOBAL" : spec.market;
}

/** One-day simulated return for an asset on a given date. */
export function demoDailyReturn(spec: AssetSpec, date: string): number {
  const steps = demoMarketOf(spec) === "GLOBAL" ? 365 : 252;
  const { mu, sigma, jumpProb = 0, jumpSize = 0 } = spec.demo;
  const z = gaussian(`${spec.id}|${date}`);
  let r = (mu - (sigma * sigma) / 2) / steps + (sigma / Math.sqrt(steps)) * z;
  if (jumpProb > 0 && uniform(`${spec.id}|jump|${date}`) < jumpProb) r += jumpSize;
  return Math.exp(r) - 1;
}

/** Stablecoins mean-revert to their peg instead of following a random walk. */
function nextPrice(spec: AssetSpec, prev: number, date: string): number {
  if (spec.demo.peg) {
    const noise = gaussian(`${spec.id}|${date}`) * spec.demo.sigma * 0.15;
    return Math.max(0, spec.demo.peg + (prev - spec.demo.peg) * 0.35 + noise);
  }
  return prev * (1 + demoDailyReturn(spec, date));
}

/** Generate a full series from `from` to `to` (inclusive) on the asset's trading days. */
export function generateDemoSeries(spec: AssetSpec, from: string, to: string): PricePoint[] {
  const market = demoMarketOf(spec);
  const out: PricePoint[] = [];
  let price = spec.demo.start;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!isTradingDay(d, market)) continue;
    price = out.length === 0 ? price : nextPrice(spec, price, d);
    out.push({ date: d, close: roundPrice(price) });
  }
  return out;
}

/** Extend an existing series to `to`, continuing from the last stored close. */
export function extendDemoSeries(spec: AssetSpec, last: PricePoint, to: string): PricePoint[] {
  const market = demoMarketOf(spec);
  const out: PricePoint[] = [];
  let price = last.close;
  for (let d = addDays(last.date, 1); d <= to; d = addDays(d, 1)) {
    if (!isTradingDay(d, market)) continue;
    price = nextPrice(spec, price, d);
    out.push({ date: d, close: roundPrice(price) });
  }
  return out;
}

function roundPrice(p: number): number {
  return p >= 100 ? Math.round(p * 100) / 100 : Math.round(p * 1e6) / 1e6;
}

export interface DemoMacroPoint {
  code: string;
  value: number;
}

/** Demo macro levels used when official sources are unreachable. */
export const DEMO_MACRO: DemoMacroPoint[] = [
  { code: "CDI", value: 0.149 },
  { code: "SELIC", value: 0.15 },
  { code: "IPCA12M", value: 0.048 },
  { code: "USDBRL", value: 5.42 },
  { code: "UST3M", value: 0.039 },
  { code: "UST10Y", value: 0.042 },
];

/** Shocks available in the demo lab. Each one writes flagged demo prices/events. */
export interface DemoScenario {
  id: string;
  label: string;
  description: string;
  priceShocks: Record<string, number>; // assetId → return applied to today's close
  macroShocks?: Record<string, number>; // code → absolute change (rates) or relative (USDBRL)
  events?: { assetId: string | null; type: string; severity: "info" | "attention" | "critical"; title: string; description: string }[];
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "crypto_crash",
    label: "Queda forte em cripto",
    description: "BTC −18%, ETH −24%, SOL −30% em um dia (simulado).",
    priceShocks: { "CR-BTC": -0.18, "CR-ETH": -0.24, "CR-SOL": -0.3 },
  },
  {
    id: "stablecoin_depeg",
    label: "Perda de paridade de stablecoin",
    description: "USDT negocia a US$ 0,965 após dúvidas sobre reservas (simulado).",
    priceShocks: { "CR-USDT": -0.035 },
    events: [{ assetId: "CR-USDT", type: "crypto", severity: "critical", title: "Stablecoin abaixo da paridade", description: "Relatos de resgates elevados e atraso na publicação de atestado de reservas (evento simulado)." }],
  },
  {
    id: "br_stress",
    label: "Estresse doméstico no Brasil",
    description: "Ibovespa −7%, dólar +6%, juros futuros sobem; FIIs recuam (simulado).",
    priceShocks: { "BR-BOVA11": -0.07, "BR-PETR4": -0.11, "BR-ITUB4": -0.08, "BR-VALE3": -0.06, "BR-WEGE3": -0.05, "BR-HGLG11": -0.04, "BR-KNCR11": -0.02, "BR-IVVB11": 0.05 },
    macroShocks: { USDBRL: 0.06, CDI: 0.005, SELIC: 0.005 },
  },
  {
    id: "credit_event",
    label: "Evento de crédito em banco médio",
    description: "Rebaixamento de rating do emissor do CDB 115% CDI (simulado).",
    priceShocks: {},
    events: [{ assetId: "BR-CDB-MED-115", type: "credit", severity: "critical", title: "Rebaixamento de rating do emissor", description: "Agência rebaixou o emissor de A- para BB+ com perspectiva negativa; resgates antecipados indisponíveis (evento simulado)." }],
  },
  {
    id: "us_rates",
    label: "Alta de juros nos EUA",
    description: "Treasuries longos −6%, Nasdaq −5%, REITs −4%; T-Bill 3M +0,40 p.p. (simulado).",
    priceShocks: { "US-TLT": -0.06, "US-TNOTE-5Y": -0.018, "US-QQQ": -0.05, "US-NVDA": -0.08, "US-MSFT": -0.04, "US-VOO": -0.03, "US-VNQ": -0.04, "US-O": -0.035, "US-LQD": -0.025, "BR-IVVB11": -0.03 },
    macroShocks: { UST3M: 0.004, UST10Y: 0.0045 },
  },
  {
    id: "rwa_platform",
    label: "Problema em plataforma de tokenização",
    description: "Plataforma suspende negociação secundária do token de recebíveis (simulado).",
    priceShocks: {},
    events: [{ assetId: "BR-RWA-RECEB", type: "liquidity", severity: "critical", title: "Negociação secundária suspensa", description: "A plataforma suspendeu temporariamente o mercado secundário e o pagamento de um lote de recebíveis atrasou (evento simulado)." }],
  },
];
