// Market calendars for B3 and NYSE. Holidays listed explicitly for 2024–2027;
// outside that window only weekends are treated as non-trading days (flagged as
// a limitation in the UI's methodology page).

const BR_HOLIDAYS = new Set([
  "2024-01-01", "2024-02-12", "2024-02-13", "2024-03-29", "2024-04-21", "2024-05-01", "2024-05-30", "2024-09-07", "2024-10-12", "2024-11-02", "2024-11-15", "2024-11-20", "2024-12-24", "2024-12-25", "2024-12-31",
  "2025-01-01", "2025-03-03", "2025-03-04", "2025-04-18", "2025-04-21", "2025-05-01", "2025-06-19", "2025-09-07", "2025-10-12", "2025-11-02", "2025-11-15", "2025-11-20", "2025-12-24", "2025-12-25", "2025-12-31",
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-04-03", "2026-04-21", "2026-05-01", "2026-06-04", "2026-09-07", "2026-10-12", "2026-11-02", "2026-11-15", "2026-11-20", "2026-12-24", "2026-12-25", "2026-12-31",
  "2027-01-01", "2027-02-08", "2027-02-09", "2027-03-26", "2027-04-21", "2027-05-01", "2027-05-27", "2027-09-07", "2027-10-12", "2027-11-02", "2027-11-15", "2027-11-20", "2027-12-24", "2027-12-25", "2027-12-31",
]);

const US_HOLIDAYS = new Set([
  "2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27", "2024-06-19", "2024-07-04", "2024-09-02", "2024-11-28", "2024-12-25",
  "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

export type CalendarMarket = "BR" | "US" | "GLOBAL";

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return toISODate(d);
}

export function isWeekend(iso: string): boolean {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/** Crypto ("GLOBAL") trades every day. */
export function isTradingDay(iso: string, market: CalendarMarket): boolean {
  if (market === "GLOBAL") return true;
  if (isWeekend(iso)) return false;
  return !(market === "BR" ? BR_HOLIDAYS : US_HOLIDAYS).has(iso);
}

export function previousTradingDay(iso: string, market: CalendarMarket): string {
  let d = addDays(iso, -1);
  while (!isTradingDay(d, market)) d = addDays(d, -1);
  return d;
}

/** Most recent trading day on or before `iso`. */
export function lastTradingDayOnOrBefore(iso: string, market: CalendarMarket): string {
  return isTradingDay(iso, market) ? iso : previousTradingDay(iso, market);
}

export function tradingDaysBetween(fromExclusive: string, toInclusive: string, market: CalendarMarket): string[] {
  const out: string[] = [];
  let d = addDays(fromExclusive, 1);
  while (d <= toInclusive) {
    if (isTradingDay(d, market)) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

export function holidayCoverage(iso: string): boolean {
  const y = Number(iso.slice(0, 4));
  return y >= 2024 && y <= 2027;
}

/** Market data status for a given asset/market as seen at `today`. */
export type DataStatus = "ok" | "no_trading_day" | "stale" | "no_data" | "source_unavailable";

export const DATA_STATUS_LABEL: Record<DataStatus, string> = {
  ok: "Atualizado",
  no_trading_day: "Sem pregão hoje",
  stale: "Desatualizado",
  no_data: "Sem dados",
  source_unavailable: "Fonte indisponível",
};

/**
 * Classify freshness. A price is fresh when it is from the last trading day
 * (allowing one extra trading day of publication lag for end-of-day sources).
 */
export function classifyFreshness(
  lastPriceDate: string | null,
  today: string,
  market: CalendarMarket,
  sourceAvailable: boolean,
): DataStatus {
  if (!sourceAvailable && !lastPriceDate) return "source_unavailable";
  if (!lastPriceDate) return "no_data";
  const expected = lastTradingDayOnOrBefore(today, market);
  const tolerated = market === "GLOBAL" ? addDays(expected, -1) : previousTradingDay(expected, market);
  if (lastPriceDate >= tolerated) {
    if (!isTradingDay(today, market)) return "no_trading_day";
    return "ok";
  }
  return sourceAvailable ? "stale" : "source_unavailable";
}
