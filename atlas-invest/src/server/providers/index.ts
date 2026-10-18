// Market data provider abstraction. Each provider fetches raw observations and
// returns them normalized; MarketDataService decides caching, persistence and
// fallback to demo data. Providers never fabricate values: on any failure they throw.

import { dailyPctToAnnual } from "@/domain/finance";
import type { AssetSpec, PricePoint } from "@/domain/types";

export interface MacroObservation {
  code: "CDI" | "SELIC" | "IPCA12M" | "USDBRL" | "UST3M" | "UST10Y";
  date: string;
  value: number;
}

export interface ProviderInfo {
  id: string;
  name: string;
  kind: "macro" | "prices" | "crypto";
  url: string;
  licenseNote: string;
  configured: () => boolean;
}

export interface MacroProvider extends ProviderInfo {
  fetchMacro(): Promise<MacroObservation[]>;
}

export interface PriceProvider extends ProviderInfo {
  supports(spec: AssetSpec): boolean;
  fetchHistory(spec: AssetSpec): Promise<PricePoint[]>;
}

const TIMEOUT_MS = 10_000;

export async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${new URL(url).host}`);
  return res.json();
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${new URL(url).host}`);
  return res.text();
}

const liveMode = () => (process.env.MARKET_DATA_MODE ?? "live") === "live";

// ───────────────────────── Banco Central do Brasil — SGS ─────────────────────────
// Public API, no key. Series: 12 (CDI diário, % a.d.), 432 (meta Selic, % a.a.),
// 13522 (IPCA acumulado 12 meses, %), 1 (dólar comercial venda — PTAX).

export function parseBcbSeries(raw: unknown): { date: string; value: number }[] {
  if (!Array.isArray(raw)) throw new Error("Resposta inesperada do SGS");
  return raw
    .map((r: { data?: string; valor?: string }) => {
      const [d, m, y] = String(r.data).split("/");
      return { date: `${y}-${m}-${d}`, value: Number(String(r.valor).replace(",", ".")) };
    })
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.value));
}

export const bcbProvider: MacroProvider = {
  id: "bcb_sgs",
  name: "Banco Central do Brasil — SGS",
  kind: "macro",
  url: "https://api.bcb.gov.br/dados/serie/bcdata.sgs.{serie}/dados",
  licenseNote: "Dados públicos do BCB. Séries diárias publicadas com defasagem de até 1 dia útil; não são cotações em tempo real.",
  configured: liveMode,
  async fetchMacro() {
    const series: [MacroObservation["code"], number, (v: number) => number][] = [
      ["CDI", 12, (v) => dailyPctToAnnual(v)],
      ["SELIC", 432, (v) => v / 100],
      ["IPCA12M", 13522, (v) => v / 100],
      ["USDBRL", 1, (v) => v],
    ];
    const out: MacroObservation[] = [];
    for (const [code, id, conv] of series) {
      const raw = await fetchJson(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${id}/dados/ultimos/30?formato=json`);
      for (const p of parseBcbSeries(raw)) out.push({ code, date: p.date, value: conv(p.value) });
    }
    return out;
  },
};

// ───────────────────────── U.S. Treasury — Daily Par Yield Curve ─────────────────────────

export function parseTreasuryXml(xml: string): MacroObservation[] {
  const out: MacroObservation[] = [];
  const entries = xml.split(/<entry>/).slice(1);
  for (const e of entries) {
    const date = /<d:NEW_DATE[^>]*>(\d{4}-\d{2}-\d{2})/.exec(e)?.[1];
    const m3 = /<d:BC_3MONTH[^>]*>([\d.]+)</.exec(e)?.[1];
    const y10 = /<d:BC_10YEAR[^>]*>([\d.]+)</.exec(e)?.[1];
    if (!date) continue;
    if (m3) out.push({ code: "UST3M", date, value: Number(m3) / 100 });
    if (y10) out.push({ code: "UST10Y", date, value: Number(y10) / 100 });
  }
  return out;
}

export const treasuryProvider: MacroProvider = {
  id: "us_treasury",
  name: "U.S. Department of the Treasury — Daily Treasury Par Yield Curve",
  kind: "macro",
  url: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/",
  licenseNote: "Dados públicos do Tesouro americano, publicados ao fim de cada dia útil. Taxas indicativas, não preços executáveis.",
  configured: liveMode,
  async fetchMacro() {
    const now = new Date();
    const months = [0, 1].map((k) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
      return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    });
    const out: MacroObservation[] = [];
    for (const m of months) {
      const xml = await fetchText(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=${m}`);
      out.push(...parseTreasuryXml(xml));
    }
    if (out.length === 0) throw new Error("Curva do Tesouro sem observações");
    return out;
  },
};

// ───────────────────────── CoinGecko ─────────────────────────

export function parseCoinGeckoChart(raw: unknown): PricePoint[] {
  const prices = (raw as { prices?: [number, number][] })?.prices;
  if (!Array.isArray(prices)) throw new Error("Resposta inesperada da CoinGecko");
  const byDate = new Map<string, number>();
  for (const [ms, p] of prices) byDate.set(new Date(ms).toISOString().slice(0, 10), p);
  return [...byDate.entries()].map(([date, close]) => ({ date, close })).sort((a, b) => a.date.localeCompare(b.date));
}

export const coingeckoProvider: PriceProvider = {
  id: "coingecko",
  name: "CoinGecko",
  kind: "crypto",
  url: "https://api.coingecko.com/api/v3",
  licenseNote: "Preços agregados de múltiplas exchanges (não executáveis). Plano gratuito com limite de requisições; atribuição exigida.",
  configured: liveMode,
  supports: (s) => s.liveProvider?.provider === "coingecko",
  async fetchHistory(spec) {
    if (spec.liveProvider?.provider !== "coingecko") throw new Error("ativo não suportado");
    const key = process.env.COINGECKO_API_KEY;
    const raw = await fetchJson(
      `https://api.coingecko.com/api/v3/coins/${spec.liveProvider.id}/market_chart?vs_currency=usd&days=365&interval=daily`,
      key ? { headers: { "x-cg-demo-api-key": key } } : undefined,
    );
    return parseCoinGeckoChart(raw);
  },
};

// ───────────────────────── Alpha Vantage (US equities/ETFs) ─────────────────────────

export function parseAlphaVantage(raw: unknown): PricePoint[] {
  const ts = (raw as Record<string, Record<string, Record<string, string>>>)?.["Time Series (Daily)"];
  if (!ts) throw new Error(String((raw as { Note?: string; Information?: string })?.Note ?? (raw as { Information?: string })?.Information ?? "Resposta inesperada da Alpha Vantage"));
  return Object.entries(ts)
    .map(([date, v]) => ({ date, close: Number(v["4. close"]) }))
    .filter((p) => Number.isFinite(p.close))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export const alphaVantageProvider: PriceProvider = {
  id: "alphavantage",
  name: "Alpha Vantage",
  kind: "prices",
  url: "https://www.alphavantage.co",
  licenseNote: "Requer chave. Dados de fim de dia; plano gratuito limitado a poucas requisições por dia. Preços não ajustados por proventos.",
  configured: () => liveMode() && !!process.env.ALPHAVANTAGE_API_KEY,
  supports: (s) => s.liveProvider?.provider === "alphavantage",
  async fetchHistory(spec) {
    if (spec.liveProvider?.provider !== "alphavantage") throw new Error("ativo não suportado");
    const raw = await fetchJson(
      `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(spec.liveProvider.symbol)}&outputsize=full&apikey=${process.env.ALPHAVANTAGE_API_KEY}`,
    );
    return parseAlphaVantage(raw).slice(-800);
  },
};

// ───────────────────────── brapi.dev (B3) ─────────────────────────

export function parseBrapi(raw: unknown): PricePoint[] {
  const hist = (raw as { results?: { historicalDataPrice?: { date: number; close: number | null }[] }[] })?.results?.[0]?.historicalDataPrice;
  if (!Array.isArray(hist)) throw new Error("Resposta inesperada da brapi");
  return hist
    .filter((h) => h.close != null)
    .map((h) => ({ date: new Date(h.date * 1000).toISOString().slice(0, 10), close: h.close as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export const brapiProvider: PriceProvider = {
  id: "brapi",
  name: "brapi.dev (B3)",
  kind: "prices",
  url: "https://brapi.dev",
  licenseNote: "Requer token. Cotações da B3 com atraso; verifique os termos de uso e a licença de redistribuição.",
  configured: () => liveMode() && !!process.env.BRAPI_TOKEN,
  supports: (s) => s.liveProvider?.provider === "brapi",
  async fetchHistory(spec) {
    if (spec.liveProvider?.provider !== "brapi") throw new Error("ativo não suportado");
    const raw = await fetchJson(`https://brapi.dev/api/quote/${encodeURIComponent(spec.liveProvider.symbol)}?range=3y&interval=1d&token=${process.env.BRAPI_TOKEN}`);
    return parseBrapi(raw);
  },
};

export const MACRO_PROVIDERS: MacroProvider[] = [bcbProvider, treasuryProvider];
export const PRICE_PROVIDERS: PriceProvider[] = [coingeckoProvider, alphaVantageProvider, brapiProvider];

export const DEMO_SOURCE = {
  id: "demo",
  name: "Atlas — gerador de dados de demonstração",
  kind: "demo",
  url: null,
  licenseNote: "Valores SIMULADOS para testar os fluxos. Não representam preços reais.",
};
