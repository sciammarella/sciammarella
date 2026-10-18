// PortfolioService — portfolios, positions, target allocations and analytics.
// All functions take a user-scoped transaction (RLS enforced).

import { z } from "zod";
import { CATALOG, CATALOG_BY_ID } from "@/domain/catalog";
import { analyzePortfolio, type HoldingInput, type PortfolioAnalytics } from "@/domain/portfolio";
import { simulateHistory, valuePosition, changeOver, type HistoryPoint } from "@/domain/valuation";
import type { Currency, MacroSnapshot } from "@/domain/types";
import { uuid, type Tx } from "@/server/db";
import { audit } from "./audit";
import { loadAnalytics, type AnalyzedAsset } from "./discovery";
import { todayISO } from "./market-data";

export interface PortfolioRow {
  id: string;
  name: string;
  description: string;
  base_currency: Currency;
  strategy: string;
  source_recommendation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PositionRow {
  id: string;
  portfolio_id: string;
  asset_id: string;
  quantity: number;
  avg_price: number;
  acquired_at: string;
  origin: "manual" | "imported";
  manual_value: number | null;
  notes: string;
}

export interface TargetRow {
  asset_id: string;
  weight: number;
  rationale: string;
}

export async function listPortfolios(tx: Tx): Promise<(PortfolioRow & { positions: number })[]> {
  return tx.query(`select p.*, (select count(*)::int from positions x where x.portfolio_id = p.id) as positions from portfolios p where not archived order by created_at`);
}

export async function getPortfolio(tx: Tx, id: string): Promise<{ portfolio: PortfolioRow; positions: PositionRow[]; targets: TargetRow[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [portfolio] = await tx.query<PortfolioRow>(`select * from portfolios where id = $1 and not archived`, [id]);
  if (!portfolio) return null;
  const positions = await tx.query<PositionRow>(`select * from positions where portfolio_id = $1 order by created_at`, [id]);
  const targets = await tx.query<TargetRow>(`select asset_id, weight, rationale from target_allocations where portfolio_id = $1 order by weight desc`, [id]);
  return { portfolio, positions, targets };
}

const PortfolioInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).default(""),
  baseCurrency: z.enum(["BRL", "USD"]),
  strategy: z.string().max(40).default("custom"),
  sourceRecommendationId: z.string().uuid().nullable().optional(),
  targets: z.array(z.object({ assetId: z.string(), weight: z.number().min(0).max(1), rationale: z.string().max(500).default("") })).default([]),
});

export async function createPortfolio(tx: Tx, userId: string, input: z.input<typeof PortfolioInput>): Promise<string> {
  const p = PortfolioInput.parse(input);
  const id = uuid();
  await tx.query(
    `insert into portfolios(id, user_id, name, description, base_currency, strategy, source_recommendation_id) values ($1,$2,$3,$4,$5,$6,$7)`,
    [id, userId, p.name, p.description, p.baseCurrency, p.strategy, p.sourceRecommendationId ?? null],
  );
  await setTargets(tx, userId, id, p.targets, false);
  await audit(tx, userId, "user", "portfolio.created", "portfolio", id, { name: p.name, strategy: p.strategy, targets: p.targets.length });
  return id;
}

export async function updatePortfolio(tx: Tx, userId: string, id: string, input: { name: string; description: string }): Promise<void> {
  const name = z.string().trim().min(1).max(80).parse(input.name);
  const description = z.string().max(500).parse(input.description ?? "");
  const r = await tx.query(`update portfolios set name=$2, description=$3, updated_at=now() where id=$1 returning id`, [id, name, description]);
  if (r.length === 0) throw new Error("Portfólio não encontrado.");
  await audit(tx, userId, "user", "portfolio.updated", "portfolio", id, { name });
}

export async function duplicatePortfolio(tx: Tx, userId: string, id: string): Promise<string> {
  const src = await getPortfolio(tx, id);
  if (!src) throw new Error("Portfólio não encontrado.");
  const newId = uuid();
  await tx.query(`insert into portfolios(id, user_id, name, description, base_currency, strategy) values ($1,$2,$3,$4,$5,$6)`, [newId, userId, `${src.portfolio.name} (cópia)`, src.portfolio.description, src.portfolio.base_currency, src.portfolio.strategy]);
  for (const p of src.positions) {
    await tx.query(
      `insert into positions(id, user_id, portfolio_id, asset_id, quantity, avg_price, acquired_at, origin, manual_value, notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [uuid(), userId, newId, p.asset_id, p.quantity, p.avg_price, p.acquired_at, p.origin, p.manual_value, p.notes],
    );
  }
  await setTargets(tx, userId, newId, src.targets.map((t) => ({ assetId: t.asset_id, weight: t.weight, rationale: t.rationale })), false);
  await audit(tx, userId, "user", "portfolio.duplicated", "portfolio", newId, { from: id });
  return newId;
}

export async function archivePortfolio(tx: Tx, userId: string, id: string): Promise<void> {
  await tx.query(`update portfolios set archived = true, updated_at = now() where id = $1`, [id]);
  await audit(tx, userId, "user", "portfolio.archived", "portfolio", id);
}

const PositionInput = z.object({
  portfolioId: z.string().uuid(),
  assetId: z.string().refine((id) => CATALOG_BY_ID.has(id), "Ativo desconhecido"),
  quantity: z.number().positive().max(1e12),
  avgPrice: z.number().min(0).max(1e9),
  acquiredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  manualValue: z.number().min(0).nullable().optional(),
  notes: z.string().max(300).default(""),
  origin: z.enum(["manual", "imported"]).default("manual"),
});

export async function addPosition(tx: Tx, userId: string, input: z.input<typeof PositionInput>): Promise<string> {
  const p = PositionInput.parse(input);
  if (p.acquiredAt > todayISO()) throw new Error("A data de aquisição não pode estar no futuro.");
  const id = uuid();
  await tx.query(
    `insert into positions(id, user_id, portfolio_id, asset_id, quantity, avg_price, acquired_at, origin, manual_value, notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, userId, p.portfolioId, p.assetId, p.quantity, p.avgPrice, p.acquiredAt, p.origin, p.manualValue ?? null, p.notes],
  );
  await tx.query(`update portfolios set updated_at = now() where id = $1`, [p.portfolioId]);
  await audit(tx, userId, "user", "position.added", "position", id, { assetId: p.assetId, quantity: p.quantity, origin: p.origin });
  return id;
}

export async function updatePosition(tx: Tx, userId: string, id: string, input: { quantity: number; avgPrice: number; acquiredAt: string; manualValue: number | null; notes: string }): Promise<void> {
  const q = z.number().positive().parse(input.quantity);
  const a = z.number().min(0).parse(input.avgPrice);
  const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(input.acquiredAt);
  const r = await tx.query(`update positions set quantity=$2, avg_price=$3, acquired_at=$4, manual_value=$5, notes=$6, updated_at=now() where id=$1 returning portfolio_id`, [id, q, a, d, input.manualValue, input.notes ?? ""]);
  if (r.length === 0) throw new Error("Posição não encontrada.");
  await audit(tx, userId, "user", "position.updated", "position", id, { quantity: q });
}

export async function deletePosition(tx: Tx, userId: string, id: string): Promise<void> {
  const r = await tx.query<{ asset_id: string }>(`delete from positions where id = $1 returning asset_id`, [id]);
  if (r.length) await audit(tx, userId, "user", "position.deleted", "position", id, { assetId: r[0].asset_id });
}

/** CSV columns: ativo,quantidade,preco_medio,data_aquisicao  (ativo = símbolo ou id do catálogo). */
export function parsePositionsCsv(csv: string): { rows: { assetId: string; quantity: number; avgPrice: number; acquiredAt: string }[]; errors: string[] } {
  const rows: { assetId: string; quantity: number; avgPrice: number; acquiredAt: string }[] = [];
  const errors: string[] = [];
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, i) => {
    // ";" or tab separators allow decimal commas; otherwise "," separates columns.
    const cols = (/[;\t]/.test(line) ? line.split(/[;\t]/) : line.split(",")).map((c) => c.trim());
    if (i === 0 && /ativo|asset|symbol/i.test(cols[0])) return;
    const [ref, qty, price, date] = cols;
    const spec = CATALOG.find((a) => a.id === ref || a.symbol.toLowerCase() === (ref ?? "").toLowerCase());
    const quantity = Number((qty ?? "").replace(",", "."));
    const avgPrice = Number((price ?? "").replace(",", "."));
    if (!spec) errors.push(`Linha ${i + 1}: ativo "${ref}" não encontrado no catálogo.`);
    else if (!(quantity > 0)) errors.push(`Linha ${i + 1}: quantidade inválida.`);
    else if (!(avgPrice >= 0)) errors.push(`Linha ${i + 1}: preço médio inválido.`);
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) errors.push(`Linha ${i + 1}: data deve estar no formato AAAA-MM-DD.`);
    else rows.push({ assetId: spec.id, quantity, avgPrice, acquiredAt: date });
  });
  return { rows, errors };
}

export async function importPositions(tx: Tx, userId: string, portfolioId: string, csv: string): Promise<{ imported: number; errors: string[] }> {
  const { rows, errors } = parsePositionsCsv(csv);
  if (errors.length) return { imported: 0, errors };
  for (const r of rows) await addPosition(tx, userId, { portfolioId, ...r, origin: "imported", notes: "Importado via CSV" });
  await audit(tx, userId, "user", "positions.imported", "portfolio", portfolioId, { count: rows.length });
  return { imported: rows.length, errors: [] };
}

export async function setTargets(tx: Tx, userId: string, portfolioId: string, targets: { assetId: string; weight: number; rationale?: string }[], log = true): Promise<void> {
  const total = targets.reduce((a, t) => a + t.weight, 0);
  if (total > 1.005) throw new Error("A soma das alocações-alvo não pode passar de 100%.");
  for (const t of targets) if (!CATALOG_BY_ID.has(t.assetId)) throw new Error(`Ativo desconhecido: ${t.assetId}`);
  await tx.query(`delete from target_allocations where portfolio_id = $1`, [portfolioId]);
  for (const t of targets) {
    if (t.weight <= 0) continue;
    await tx.query(`insert into target_allocations(id, user_id, portfolio_id, asset_id, weight, rationale) values ($1,$2,$3,$4,$5,$6)`, [uuid(), userId, portfolioId, t.assetId, t.weight, t.rationale ?? ""]);
  }
  if (log) await audit(tx, userId, "user", "targets.updated", "portfolio", portfolioId, { count: targets.length, total });
}

/** Create positions sized to the target allocation for a given amount (convenience for planning). */
export async function fillFromTargets(tx: Tx, userId: string, portfolioId: string, amount: number): Promise<number> {
  const pf = await getPortfolio(tx, portfolioId);
  if (!pf) throw new Error("Portfólio não encontrado.");
  if (!(amount > 0)) throw new Error("Informe um valor positivo.");
  const { macro, assets } = await loadAnalytics(tx, pf.targets.map((t) => t.asset_id), pf.portfolio.base_currency, 1);
  const today = todayISO();
  let n = 0;
  for (const t of pf.targets) {
    const a = assets.get(t.asset_id);
    if (!a) continue;
    const valueBase = amount * t.weight;
    const local = a.spec.currency === pf.portfolio.base_currency ? valueBase : a.spec.currency === "USD" ? valueBase / macro.usdbrl : valueBase * macro.usdbrl;
    const price = a.spec.pricing === "accrual" ? 1 : a.md.prices[a.md.prices.length - 1]?.close;
    if (!price) continue;
    await addPosition(tx, userId, { portfolioId, assetId: t.asset_id, quantity: Math.round((local / price) * 1e6) / 1e6, avgPrice: price, acquiredAt: today, notes: "Gerada a partir da alocação-alvo — confirme quantidades reais." });
    n++;
  }
  return n;
}

export interface PortfolioView {
  portfolio: PortfolioRow;
  positions: (PositionRow & { valueBase: number; costBase: number; valuation: string; price: number | null; priceDate: string | null; pnlBase: number })[];
  targets: TargetRow[];
  analytics: PortfolioAnalytics | null;
  assets: Map<string, AnalyzedAsset>;
  macro: MacroSnapshot;
  history: HistoryPoint[];
  changes: { d1: number | null; d30: number | null; d365: number | null };
}

export async function portfolioView(tx: Tx, id: string, horizonYears: number, withHistory = true): Promise<PortfolioView | null> {
  const pf = await getPortfolio(tx, id);
  if (!pf) return null;
  const base = pf.portfolio.base_currency;
  const ids = [...new Set([...pf.positions.map((p) => p.asset_id), ...pf.targets.map((t) => t.asset_id), ...(withHistory ? ["BR-BOVA11", "US-VOO"] : [])])];
  const { macro, assets } = await loadAnalytics(tx, ids, base, horizonYears);
  const today = todayISO();

  // Aggregate positions per asset for analytics; keep line-level detail for the table.
  const lines = pf.positions.map((p) => {
    const a = assets.get(p.asset_id)!;
    const v = valuePosition(a.spec, { quantity: p.quantity, avgPrice: p.avg_price, acquiredAt: p.acquired_at, manualValue: p.manual_value }, a.md.prices, a.md.origin, macro, base, today);
    return { ...p, valueBase: v.valueBase, costBase: v.costBase, valuation: v.valuation, price: v.price, priceDate: v.priceDate, pnlBase: v.valueBase - v.costBase };
  });
  const perAsset = new Map<string, { value: number; origin: "manual" | "imported"; valuation: HoldingInput["valuation"] }>();
  for (const l of lines) {
    const cur = perAsset.get(l.asset_id);
    perAsset.set(l.asset_id, { value: (cur?.value ?? 0) + l.valueBase, origin: cur?.origin === "imported" || l.origin === "imported" ? "imported" : "manual", valuation: l.valuation as HoldingInput["valuation"] });
  }
  const targetMap = new Map(pf.targets.map((t) => [t.asset_id, t.weight]));
  const inputs: HoldingInput[] = [...perAsset.entries()].map(([assetId, h]) => {
    const a = assets.get(assetId)!;
    return { spec: a.spec, analytics: a.analytics, valueBase: h.value, prices: a.md.prices, origin: h.origin, valuation: h.valuation, targetWeight: targetMap.has(assetId) ? targetMap.get(assetId)! : pf.targets.length ? 0 : null };
  });
  const analytics = analyzePortfolio(inputs, base, horizonYears);

  let history: HistoryPoint[] = [];
  if (withHistory && pf.positions.length) {
    const bm: Record<string, { date: string; close: number }[]> = {};
    const bova = assets.get("BR-BOVA11");
    const voo = assets.get("US-VOO");
    if (bova) bm.ibov = bova.md.prices;
    if (voo) bm.sp500 = voo.md.prices;
    history = simulateHistory(
      pf.positions.map((p) => ({ spec: assets.get(p.asset_id)!.spec, pos: { quantity: p.quantity, avgPrice: p.avg_price, acquiredAt: p.acquired_at, manualValue: p.manual_value }, prices: assets.get(p.asset_id)!.md.prices })),
      macro, base, today, 365, bm,
    );
  }
  return {
    portfolio: pf.portfolio,
    positions: lines,
    targets: pf.targets,
    analytics,
    assets,
    macro,
    history,
    changes: { d1: changeOver(history, 1), d30: changeOver(history, 30), d365: changeOver(history, 365) },
  };
}
