import type { Currency } from "@/domain/types";

export function money(n: number | null | undefined, currency: Currency = "BRL", digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(currency === "BRL" ? "pt-BR" : "en-US", { style: "currency", currency, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

export function num(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(n);
}

export function pct(n: number | null | undefined, digits = 1, signed = false): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const floor = 0.5 * 10 ** -(digits + 2);
  if (n > 0 && n < floor) return `<${(10 ** -digits).toFixed(digits).replace(".", ",")}%`;
  const s = `${(n * 100).toFixed(digits).replace(".", ",")}%`;
  return signed && n > 0 ? `+${s}` : s;
}

export function dateBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

export function dateTimeBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
}
