import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/session";
import { pct } from "@/lib/format";
import { withUser } from "@/server/db";
import { discover } from "@/server/services/discovery";
import { RISK_COMPONENT_LABEL } from "@/domain/types";
import { DiscoverClient, type DiscoverRow } from "./client";

export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const { user, profile } = await requireProfile();
  const { items, macro } = await withUser(user.id, (tx) => discover(tx, profile));
  const rows: DiscoverRow[] = items.map(({ spec, md, analytics: an, opportunity: op }) => {
    const comp = (k: string) => an.risk.components.find((c) => c.key === k)?.score ?? null;
    return {
      id: spec.id, symbol: spec.symbol, name: spec.name, assetClass: spec.assetClass, market: spec.market, currency: spec.currency,
      base: an.expected?.scenarios.base ?? null, pessimistic: an.expected?.scenarios.pessimistic ?? null, optimistic: an.expected?.scenarios.optimistic ?? null,
      afterTax: an.expected?.afterTaxBase ?? null, probLoss: an.expected?.probabilityOfLoss ?? null,
      volatility: an.historical?.volatility ?? (spec.pricing === "accrual" ? an.expected?.volatilityUsed ?? null : null),
      volatilitySource: an.historical ? "histórico" : spec.pricing === "accrual" ? "duration" : "—",
      maxDrawdown: an.historical?.maxDrawdown ?? null, return1y: an.historical?.return1y ?? null,
      risk: an.risk.score, riskCategory: an.risk.category,
      credit: comp("credit"), counterparty: comp("counterparty"), technology: comp("technology"), liquidityScore: comp("liquidity"),
      componentSummary: an.risk.components.map((c) => ({ label: RISK_COMPONENT_LABEL[c.key], score: c.score })),
      liquidityDays: spec.lockedUntilMaturity ? null : spec.liquidityDays, locked: !!spec.lockedUntilMaturity, maturity: spec.maturity ?? null,
      minHorizon: spec.minHorizonYears ?? null, fees: spec.feesAnnual, taxNote: spec.tax.note,
      dataQuality: an.dataQuality.score, dataQualityLabel: an.dataQuality.label, origin: md.origin, source: md.sourceName, status: md.status, lastDate: an.lastPriceDate ?? md.lastUpdated,
      eligible: op.eligible, eligibilityIssues: op.eligibilityIssues, compatibility: op.compatibility, compatibilityScore: op.compatibilityScore,
      reasons: op.reasons, warnings: op.warnings, rationale: op.rationale, meetsTarget: op.meetsTargetInBase, fxAdjusted: !!an.expected?.fxAdjusted,
      insufficient: an.insufficientData,
    };
  });
  return (
    <>
      <PageHeader
        eyebrow="Investment Discovery"
        title="Descobrir oportunidades"
        description={<>Universo de {rows.length} ativos no Brasil, EUA e global, avaliados para o seu perfil <b>{profile.derived.label}</b> (risco máx. {profile.derived.maxRiskScore}/10, meta {pct(profile.answers.targetReturn)} a.a., horizonte {profile.derived.horizonYears} ano(s)). Retornos esperados são cenários de modelo em {profile.answers.baseCurrency}, não garantias.</>}
      />
      <DiscoverClient rows={rows} target={profile.answers.targetReturn} maxRisk={profile.derived.maxRiskScore} base={profile.answers.baseCurrency} macroAsOf={macro.asOf} macroDemo={Object.values(macro.origin).includes("demo")} />
    </>
  );
}
