// Deterministic tools exposed to the AI agent. The language model never computes
// financial metrics itself: every number it may cite comes from these functions,
// and every call is recorded as evidence on the resulting recommendation.

import { CATALOG } from "@/domain/catalog";
import { ASSET_CLASS_SHORT, RISK_CATEGORY_LABEL, type AssetClass } from "@/domain/types";
import type { Tx } from "@/server/db";
import { discover, loadAnalytics } from "@/server/services/discovery";
import { listAlerts } from "@/server/services/monitoring";
import { listPortfolios, portfolioView } from "@/server/services/portfolio";
import type { StoredProfile } from "@/server/services/profile";

/** What a provider holds while the agent runs; each tool call opens its own short RLS transaction. */
export interface ToolContext {
  userId: string;
  profile: StoredProfile;
}

export interface ToolRunContext {
  tx: Tx;
  profile: StoredProfile;
}

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
  run(ctx: ToolRunContext, input: Record<string, unknown>): Promise<unknown>;
}

export interface ReviewSignals {
  portfolioId: string;
  name: string;
  posture: "manter" | "rebalancear" | "revisar" | "reduzir exposição";
  reasons: string[];
}

/** Deterministic review posture: the model may explain it but does not decide it. */
export async function reviewSignals(tx: Tx, profile: StoredProfile, portfolioId: string): Promise<ReviewSignals | null> {
  const v = await portfolioView(tx, portfolioId, profile.derived.horizonYears, false);
  if (!v?.analytics) return null;
  const a = v.analytics;
  const reasons: string[] = [];
  const open = (await listAlerts(tx, { portfolioId, status: "open" }, 50));
  const critical = open.filter((x) => x.severity === "critical");
  let posture: ReviewSignals["posture"] = "manter";
  if (a.risk.score > profile.derived.maxRiskScore) {
    posture = "reduzir exposição";
    reasons.push(`Risco consolidado ${a.risk.score}/10 acima do limite do perfil (${profile.derived.maxRiskScore}/10).`);
  }
  const worst = Math.min(...a.stress.map((s) => s.impact));
  if (-worst > profile.derived.maxDrawdown * 1.5) {
    posture = "reduzir exposição";
    reasons.push(`Pior estresse (${(worst * 100).toFixed(1)}%) muito acima da queda tolerável (${(profile.derived.maxDrawdown * 100).toFixed(0)}%).`);
  }
  if (critical.length) {
    if (posture === "manter") posture = "revisar";
    reasons.push(`${critical.length} alerta(s) crítico(s) em aberto: ${critical.slice(0, 3).map((c) => c.title).join("; ")}.`);
  }
  const drifted = a.holdings.filter((h) => h.drift != null && Math.abs(h.drift) >= 0.05);
  if (drifted.length && posture === "manter") posture = "rebalancear";
  if (drifted.length) reasons.push(`Desvios de alocação ≥ 5 p.p.: ${drifted.map((h) => `${h.symbol} (${(h.drift! * 100).toFixed(1)} p.p.)`).join(", ")}.`);
  if (a.liquidity.d1 + a.liquidity.d5 < profile.derived.minLiquidWeight) {
    if (posture === "manter") posture = "revisar";
    reasons.push(`Liquidez em até 5 dias (${((a.liquidity.d1 + a.liquidity.d5) * 100).toFixed(0)}%) abaixo do mínimo do perfil (${(profile.derived.minLiquidWeight * 100).toFixed(0)}%).`);
  }
  if (reasons.length === 0) reasons.push("Risco, liquidez e alocação dentro dos limites do perfil e sem alertas críticos em aberto.");
  return { portfolioId, name: v.portfolio.name, posture, reasons };
}

const r = (n: number | null | undefined, d = 4) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

export const TOOLS: ToolSpec[] = [
  {
    name: "get_profile",
    description: "Retorna o perfil de investimento do usuário (respostas do onboarding e limites derivados: nível de risco, queda máxima tolerável, limites de cripto e liquidez).",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    async run({ profile }) {
      return { answers: profile.answers, derived: profile.derived };
    },
  },
  {
    name: "list_portfolios",
    description: "Lista os portfólios salvos do usuário com valor total, nota de risco e retorno esperado.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    async run({ tx, profile }) {
      const pfs = await listPortfolios(tx);
      const out = [];
      for (const p of pfs) {
        const v = await portfolioView(tx, p.id, profile.derived.horizonYears, false);
        out.push({ id: p.id, name: p.name, positions: p.positions, totalValue: r(v?.analytics?.totalValue ?? 0, 2), baseCurrency: p.base_currency, riskScore: v?.analytics?.risk.score ?? null, expectedReturn: r(v?.analytics?.expectedReturn) });
      }
      return out;
    },
  },
  {
    name: "get_portfolio_analytics",
    description: "Métricas determinísticas de um portfólio: alocação, risco consolidado e componentes, cenários, testes de estresse, liquidez, custos, concentração e desvios da alocação-alvo.",
    input_schema: { type: "object", properties: { portfolio_id: { type: "string", description: "ID do portfólio (de list_portfolios)" } }, required: ["portfolio_id"], additionalProperties: false },
    async run({ tx, profile }, input) {
      const v = await portfolioView(tx, String(input.portfolio_id), profile.derived.horizonYears, true);
      if (!v) return { error: "Portfólio não encontrado." };
      const a = v.analytics;
      if (!a) return { name: v.portfolio.name, error: "Portfólio sem posições." };
      return {
        name: v.portfolio.name,
        totalValue: r(a.totalValue, 2), baseCurrency: a.baseCurrency,
        expectedReturn: r(a.expectedReturn), volatility: r(a.volatility), range: { pessimistic: r(a.range.pessimistic), base: r(a.range.base), optimistic: r(a.range.optimistic) },
        probabilityOfLoss: r(a.probabilityOfLoss), horizonYears: a.horizonYears,
        risk: { score: a.risk.score, category: RISK_CATEGORY_LABEL[a.risk.category], components: a.risk.components.map((c) => ({ key: c.key, score: c.score })), explanation: a.risk.explanation, limitations: a.risk.limitations },
        holdings: a.holdings.map((h) => ({ assetId: h.assetId, symbol: h.symbol, class: ASSET_CLASS_SHORT[h.assetClass], weight: r(h.weight), target: r(h.targetWeight), drift: r(h.drift), risk: h.riskScore, valuation: h.valuation })),
        byClass: a.byClass.map((g) => ({ class: ASSET_CLASS_SHORT[g.key as AssetClass] ?? g.key, weight: r(g.weight) })),
        byCurrency: a.byCurrency.map((g) => ({ currency: g.key, weight: r(g.weight) })),
        fxExposure: r(a.fxExposure), liquidity: { d1: r(a.liquidity.d1), d5: r(a.liquidity.d5), d30: r(a.liquidity.d30), beyond: r(a.liquidity.beyond) },
        costs: { weightedFee: r(a.costs.weightedFee), annualCost: r(a.costs.annualCost, 2) },
        concentration: { issuerHHI: r(a.concentration.issuerHHI), topIssuer: a.concentration.topIssuer },
        stress: a.stress.map((s) => ({ scenario: s.label, impact: r(s.impact) })),
        riskFactors: a.riskFactors,
        demoShare: r(a.demoShare), estimatedShare: r(a.estimatedShare),
        simulatedChange: { d30: r(v.changes.d30), d365: r(v.changes.d365), note: "Desempenho simulado da composição atual (quantidades e câmbio constantes); não é rentabilidade realizada." },
        dataAsOf: v.macro.asOf,
      };
    },
  },
  {
    name: "search_opportunities",
    description: "Descobre oportunidades elegíveis para o perfil do usuário, ordenadas por compatibilidade. Filtros opcionais por classe, mercado, nota de risco máxima e retorno mínimo no cenário-base.",
    input_schema: {
      type: "object",
      properties: {
        asset_classes: { type: "array", items: { type: "string", enum: Object.keys(ASSET_CLASS_SHORT) } },
        market: { type: "string", enum: ["BR", "US", "GLOBAL", "any"] },
        max_risk: { type: "number", minimum: 1, maximum: 10 },
        min_base_return: { type: "number", description: "fração anual, ex. 0.12" },
        limit: { type: "number", minimum: 1, maximum: 15 },
      },
      required: [],
      additionalProperties: false,
    },
    async run({ tx, profile }, input) {
      const { items } = await discover(tx, profile);
      const classes = Array.isArray(input.asset_classes) ? (input.asset_classes as string[]) : null;
      const market = typeof input.market === "string" && input.market !== "any" ? input.market : null;
      const maxRisk = typeof input.max_risk === "number" ? input.max_risk : null;
      const minRet = typeof input.min_base_return === "number" ? input.min_base_return : null;
      const limit = typeof input.limit === "number" ? Math.min(15, input.limit) : 8;
      return items
        .filter((i) => i.opportunity.eligible)
        .filter((i) => !classes || classes.includes(i.spec.assetClass))
        .filter((i) => !market || i.spec.market === market)
        .filter((i) => maxRisk == null || i.analytics.risk.score <= maxRisk)
        .filter((i) => minRet == null || (i.analytics.expected?.scenarios.base ?? -1) >= minRet)
        .slice(0, limit)
        .map((i) => assetSummary(i));
    },
  },
  {
    name: "compare_assets",
    description: "Compara ativos lado a lado com métricas determinísticas (cenários, risco por componente, liquidez, custos, qualidade de dados).",
    input_schema: { type: "object", properties: { asset_ids: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 } }, required: ["asset_ids"], additionalProperties: false },
    async run({ tx, profile }, input) {
      const ids = (input.asset_ids as string[]).filter((id) => CATALOG.some((a) => a.id === id));
      if (ids.length < 2) return { error: "Informe ao menos dois IDs válidos do catálogo." };
      const { assets } = await loadAnalytics(tx, ids, profile.answers.baseCurrency, profile.derived.horizonYears);
      return [...assets.values()].map((a) => ({
        ...assetSummary({ ...a, opportunity: null }),
        riskComponents: a.analytics.risk.components.map((c) => ({ key: c.key, score: c.score })),
        historical: a.analytics.historical && { volatility: r(a.analytics.historical.volatility), maxDrawdown: r(a.analytics.historical.maxDrawdown), return1y: r(a.analytics.historical.return1y) },
        note: "Métricas de classes diferentes (renda fixa, ações, cripto, tokenizados) não são diretamente comparáveis: compare cenários e componentes de risco, não apenas a volatilidade.",
      }));
    },
  },
  {
    name: "get_review_signals",
    description: "Postura de revisão determinística de um portfólio (manter, rebalancear, revisar ou reduzir exposição) com os motivos. Use-a como base para a recomendação final.",
    input_schema: { type: "object", properties: { portfolio_id: { type: "string" } }, required: ["portfolio_id"], additionalProperties: false },
    async run({ tx, profile }, input) {
      return (await reviewSignals(tx, profile, String(input.portfolio_id))) ?? { error: "Portfólio não encontrado ou sem posições." };
    },
  },
  {
    name: "get_recent_alerts",
    description: "Alertas recentes do monitoramento (o que mudou, severidade, ação sugerida).",
    input_schema: { type: "object", properties: { limit: { type: "number", minimum: 1, maximum: 20 } }, required: [], additionalProperties: false },
    async run({ tx }, input) {
      const alerts = await listAlerts(tx, {}, typeof input.limit === "number" ? input.limit : 10);
      return alerts.map((a) => ({ id: a.id, severity: a.severity, title: a.title, whatChanged: a.what_changed, suggestedAction: a.suggested_action, portfolio: a.portfolio_name, status: a.status, analyzedAt: a.analyzed_at, usesDemoData: a.uses_demo_data }));
    },
  },
];

function assetSummary(i: { spec: (typeof CATALOG)[number]; md: { origin: string | null; sourceName: string | null; status: string }; analytics: import("@/domain/analytics").AssetAnalytics; opportunity: import("@/domain/discovery").Opportunity | null }) {
  const sc = i.analytics.expected?.scenarios;
  return {
    assetId: i.spec.id, symbol: i.spec.symbol, name: i.spec.name, class: ASSET_CLASS_SHORT[i.spec.assetClass], market: i.spec.market, currency: i.spec.currency,
    scenarios: sc ? { pessimistic: r(sc.pessimistic), base: r(sc.base), optimistic: r(sc.optimistic) } : null,
    afterTaxBase: r(i.analytics.expected?.afterTaxBase),
    probabilityOfLoss: r(i.analytics.expected?.probabilityOfLoss),
    risk: i.analytics.risk.score, riskCategory: RISK_CATEGORY_LABEL[i.analytics.risk.category],
    liquidityDays: i.spec.lockedUntilMaturity ? "no vencimento" : i.spec.liquidityDays, feesAnnual: i.spec.feesAnnual,
    compatibility: i.opportunity?.compatibility ?? null, warnings: i.opportunity?.warnings ?? [],
    dataQuality: i.analytics.dataQuality.label, dataOrigin: i.md.origin, source: i.md.sourceName, dataStatus: i.md.status,
  };
}
