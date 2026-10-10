import { airlineName } from "@engine/airlines.ts";
import { formatDistanceToNowStrict } from "date-fns";

export function money(amount: number | null | undefined, currency = "USD", opts: { decimals?: boolean } = {}) {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  const decimals = opts.decimals ?? (currency !== "JPY" && Math.round(amount) !== amount);
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  });
}

export function dateLabel(d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", year: "numeric" }) {
  if (!d) return "—";
  const date = d.length === 10 ? new Date(`${d}T12:00:00Z`) : new Date(d);
  return date.toLocaleDateString("en-US", { ...opts, timeZone: d.length === 10 || !d.endsWith("Z") ? "UTC" : undefined });
}

export function shortDate(d: string | null | undefined) {
  return dateLabel(d, { month: "short", day: "numeric" });
}

/** Local airport time from "YYYY-MM-DDTHH:MM:SS" (no offset). */
export function localTime(iso: string) {
  return iso.slice(11, 16);
}

export function localDate(iso: string) {
  return dateLabel(iso.slice(0, 10), { weekday: "short", month: "short", day: "numeric" });
}

export function dayOffset(fromIso: string, toIso: string) {
  const diff = Math.round((Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`)) / 86400000);
  return diff;
}

export function duration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function relative(iso: string | null | undefined) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  const s = formatDistanceToNowStrict(t, { roundingMethod: "floor" });
  return t > Date.now() ? `in ${s}` : `${s} ago`;
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function carriers(codes: string[]) {
  return codes.map(airlineName).join(" · ");
}

export function stopsLabel(n: number) {
  return n === 0 ? "Nonstop" : `${n} stop${n > 1 ? "s" : ""}`;
}
