// Recommendation history with evidence, methodology versions and confidence.

import { CMA_METHODOLOGY_VERSION } from "@/domain/analytics";
import { ALERT_RULES_VERSION } from "@/domain/alerts";
import { assessTargetFeasibility, buildProposal, BUILDER_METHODOLOGY_VERSION, type Candidate, type Proposal, type Strategy } from "@/domain/builder";
import { analyzePortfolio, type PortfolioAnalytics } from "@/domain/portfolio";
import { PROFILE_METHODOLOGY_VERSION } from "@/domain/profile";
import { RISK_METHODOLOGY_VERSION } from "@/domain/risk";
import { uuid, type Tx } from "@/server/db";
import { audit } from "./audit";
import { discover } from "./discovery";
import { todayISO } from "./market-data";
import type { StoredProfile } from "./profile";

export const METHODOLOGY_VERSIONS = {
  profile: PROFILE_METHODOLOGY_VERSION,
  risk: RISK_METHODOLOGY_VERSION,
  cma: CMA_METHODOLOGY_VERSION,
  builder: BUILDER_METHODOLOGY_VERSION,
  alerts: ALERT_RULES_VERSION,
};

export interface EvidenceInput {
  label: string;
  value: unknown;
  source: string;
  dataAsOf: string | null;
  isDemo: boolean;
}

export interface RecommendationRow {
  id: string;
  portfolio_id: string | null;
  kind: string;
  title: string;
  summary: string;
  body: Record<string, unknown>;
  confidence: "baixa" | "média" | "alta";
  confidence_score: number;
  methodology_versions: Record<string, string>;
  data_as_of: string | null;
  uses_demo_data: boolean;
  generator: string;
  created_at: string;
}

export function confidenceFromScore(score: number): "baixa" | "média" | "alta" {
  return score >= 75 ? "alta" : score >= 50 ? "média" : "baixa";
}

export async function saveRecommendation(
  tx: Tx,
  userId: string,
  r: { portfolioId?: string | null; kind: string; title: string; summary: string; body: unknown; confidenceScore: number; dataAsOf: string | null; usesDemoData: boolean; generator: string; evidence: EvidenceInput[] },
): Promise<string> {
  const id = uuid();
  await tx.query(
    `insert into recommendations(id, user_id, portfolio_id, kind, title, summary, body, confidence, confidence_score, methodology_versions, data_as_of, uses_demo_data, generator)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, userId, r.portfolioId ?? null, r.kind, r.title, r.summary, JSON.stringify(r.body), confidenceFromScore(r.confidenceScore), Math.round(r.confidenceScore), JSON.stringify(METHODOLOGY_VERSIONS), r.dataAsOf, r.usesDemoData, r.generator],
  );
  for (const e of r.evidence) {
    await tx.query(
      `insert into recommendation_evidence(id, user_id, recommendation_id, label, value, source, data_as_of, is_demo) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [uuid(), userId, id, e.label, JSON.stringify(e.value), e.source, e.dataAsOf, e.isDemo],
    );
  }
  await audit(tx, userId, r.generator.startsWith("anthropic") ? "agent" : "system", "recommendation.created", "recommendation", id, { kind: r.kind, title: r.title, generator: r.generator });
  return id;
}

export async function listRecommendations(tx: Tx, limit = 100): Promise<RecommendationRow[]> {
  return tx.query<RecommendationRow>(`select * from recommendations order by created_at desc limit $1`, [limit]);
}

export async function getRecommendation(tx: Tx, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [rec] = await tx.query<RecommendationRow>(`select * from recommendations where id = $1`, [id]);
  if (!rec) return null;
  const evidence = await tx.query<{ id: string; label: string; value: unknown; source: string; data_as_of: string | null; is_demo: boolean }>(
    `select id, label, value, source, data_as_of, is_demo from recommendation_evidence where recommendation_id = $1 order by label`,
    [id],
  );
  return { rec, evidence };
}

export interface ProposalResult {
  proposal: Proposal;
  metrics: PortfolioAnalytics | null;
  compatible: boolean;
  compatibilityNotes: string[];
}

/** Generate the three comparable proposals for the user's profile and store them as one recommendation. */
export async function generateProposals(tx: Tx, userId: string, profile: StoredProfile, amount?: number) {
  const { macro, items } = await discover(tx, profile);
  const candidates: Candidate[] = items.map((i) => ({ spec: i.spec, analytics: i.analytics, opportunity: i.opportunity }));
  const total = amount && amount > 0 ? amount : profile.answers.amount;
  const strategies: Strategy[] = ["conservative", "balanced", "aggressive"];
  const results: ProposalResult[] = strategies.map((s) => {
    const proposal = buildProposal(s, candidates, profile.answers, profile.derived);
    const inputs = proposal.lines.map((l) => {
      const c = candidates.find((x) => x.spec.id === l.assetId)!;
      return { spec: c.spec, analytics: c.analytics, valueBase: total * l.weight, prices: items.find((i) => i.spec.id === l.assetId)!.md.prices, origin: "manual" as const, valuation: (c.analytics.market.origin === "real" ? "market_real" : c.spec.pricing === "accrual" ? "estimated" : "market_demo") as "market_real" | "estimated" | "market_demo" };
    });
    const metrics = analyzePortfolio(inputs, profile.answers.baseCurrency, profile.derived.horizonYears);
    const notes: string[] = [];
    let compatible = !!metrics;
    if (metrics) {
      if (metrics.risk.score > profile.derived.maxRiskScore) {
        compatible = false;
        notes.push(`Risco ${metrics.risk.score}/10 acima do limite do seu perfil (${profile.derived.maxRiskScore}/10).`);
      }
      const worst = Math.min(...metrics.stress.map((x) => x.impact));
      if (-worst > profile.derived.maxDrawdown * 1.5) {
        compatible = false;
        notes.push(`Pior cenário de estresse (${(worst * 100).toFixed(1)}%) excede bastante a queda tolerável (${(profile.derived.maxDrawdown * 100).toFixed(0)}%).`);
      } else if (-worst > profile.derived.maxDrawdown) {
        notes.push(`Pior cenário de estresse (${(worst * 100).toFixed(1)}%) acima da queda tolerável (${(profile.derived.maxDrawdown * 100).toFixed(0)}%) — aceitável apenas em eventos extremos.`);
      }
      if (metrics.liquidity.d1 + metrics.liquidity.d5 < profile.derived.minLiquidWeight - 0.001) {
        compatible = false;
        notes.push("Liquidez abaixo do mínimo exigido pelo seu perfil.");
      }
    }
    if (compatible) notes.push("Compatível com os limites do seu perfil.");
    return { proposal, metrics, compatible, compatibilityNotes: notes };
  });
  const feasibility = assessTargetFeasibility(
    profile.answers.targetReturn,
    results.filter((r) => r.metrics).map((r) => ({ strategy: r.proposal.strategy, expectedReturn: r.metrics!.expectedReturn, riskScore: r.metrics!.risk.score, compatible: r.compatible })),
  );

  const used = new Set(results.flatMap((r) => r.proposal.lines.map((l) => l.assetId)));
  const usedItems = items.filter((i) => used.has(i.spec.id));
  const usesDemo = usedItems.some((i) => i.md.origin !== "real") || Object.values(macro.origin).includes("demo");
  const dq = usedItems.reduce((a, i) => a + i.analytics.dataQuality.score, 0) / Math.max(1, usedItems.length);
  // Prefer compatible alternatives whose worst stress fits the tolerated drawdown; then highest expected return.
  const withinStress = (r: ProposalResult) => -Math.min(...r.metrics!.stress.map((x) => x.impact)) <= profile.derived.maxDrawdown;
  const recommended = [...results]
    .filter((r) => r.compatible && r.metrics)
    .sort((a, b) => Number(withinStress(b)) - Number(withinStress(a)) || b.metrics!.expectedReturn - a.metrics!.expectedReturn)[0];

  const evidence: EvidenceInput[] = [
    { label: "Perfil", value: { level: profile.derived.level, label: profile.derived.label, maxRiskScore: profile.derived.maxRiskScore, maxDrawdown: profile.derived.maxDrawdown }, source: "Atlas UserProfileService", dataAsOf: profile.updatedAt, isDemo: false },
    { label: "Indicadores macro", value: { cdi: macro.cdi, selic: macro.selic, ipca12m: macro.ipca12m, usdbrl: macro.usdbrl, ust3m: macro.ust3m }, source: Object.values(macro.origin).includes("demo") ? "Dados de demonstração / BCB / Treasury" : "BCB / U.S. Treasury", dataAsOf: macro.asOf, isDemo: Object.values(macro.origin).includes("demo") },
    ...usedItems.map((i) => ({
      label: `Ativo ${i.spec.symbol}`,
      value: { risk: i.analytics.risk.score, category: i.analytics.risk.category, scenarios: i.analytics.expected?.scenarios ?? null, dataQuality: i.analytics.dataQuality.score },
      source: i.md.sourceName ?? "—",
      dataAsOf: i.analytics.lastPriceDate ?? i.md.lastUpdated,
      isDemo: i.md.origin !== "real",
    })),
  ];
  const summary = recommended
    ? `Alternativa sugerida: ${recommended.proposal.label} — retorno esperado (cenário-base) de ${(recommended.metrics!.expectedReturn * 100).toFixed(1)}% a.a., risco ${recommended.metrics!.risk.score}/10. ${feasibility.message}`
    : feasibility.message;
  const recId = await saveRecommendation(tx, userId, {
    kind: "portfolio_proposal",
    title: `Propostas de portfólio — meta ${(profile.answers.targetReturn * 100).toFixed(1)}% a.a.`,
    summary,
    body: {
      amount: total,
      baseCurrency: profile.answers.baseCurrency,
      feasibility,
      recommendedStrategy: recommended?.proposal.strategy ?? null,
      proposals: results.map((r) => ({
        strategy: r.proposal.strategy, label: r.proposal.label, lines: r.proposal.lines, notes: r.proposal.notes, compatible: r.compatible, compatibilityNotes: r.compatibilityNotes,
        metrics: r.metrics && {
          expectedReturn: r.metrics.expectedReturn, volatility: r.metrics.volatility, range: r.metrics.range, probabilityOfLoss: r.metrics.probabilityOfLoss, risk: r.metrics.risk,
          liquidity: r.metrics.liquidity, costs: r.metrics.costs, stress: r.metrics.stress, byClass: r.metrics.byClass, byCurrency: r.metrics.byCurrency, byMarket: r.metrics.byMarket,
          bySector: r.metrics.bySector, byIssuer: r.metrics.byIssuer, concentration: r.metrics.concentration, correlation: r.metrics.correlation, riskFactors: r.metrics.riskFactors, fxExposure: r.metrics.fxExposure,
        },
      })),
      disclaimer: "Alocações são propostas analíticas, não ordens de investimento. Cenários são estimativas de modelo e não garantem resultados.",
    },
    confidenceScore: dq,
    dataAsOf: macro.asOf,
    usesDemoData: usesDemo,
    generator: "rules",
    evidence,
  });
  return { recommendationId: recId, results, feasibility, recommended: recommended?.proposal.strategy ?? null, usesDemo, asOf: todayISO() };
}
