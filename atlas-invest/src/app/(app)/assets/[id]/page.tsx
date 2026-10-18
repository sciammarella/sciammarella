import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, Plus } from "lucide-react";
import { CompatibilityBadge, DataStatusBadge, OriginBadge, RiskBadge } from "@/components/badges";
import { PriceChart } from "@/components/charts";
import { PageHeader, Stat } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScenarioRange, ScoreBar } from "@/components/viz";
import { CATALOG_BY_ID } from "@/domain/catalog";
import { evaluateOpportunity } from "@/domain/discovery";
import { contractualYield, CMA_METHODOLOGY_VERSION } from "@/domain/analytics";
import { ASSET_CLASS_LABEL, RISK_COMPONENT_LABEL } from "@/domain/types";
import { dateBR, dateTimeBR, num, pct } from "@/lib/format";
import { requireProfile } from "@/lib/session";
import { withUser } from "@/server/db";
import { loadAnalytics } from "@/server/services/discovery";
import { listPortfolios } from "@/server/services/portfolio";

export const dynamic = "force-dynamic";

const ELIGIBILITY_LABEL: Record<string, string> = {
  qualified_investor: "Investidor qualificado/profissional",
  accredited_investor: "Accredited investor (EUA)",
  us_person_restricted: "Restrito a não-US persons",
  br_resident_only: "Residentes no Brasil",
  us_resident_only: "Residentes nos EUA",
};

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const spec = CATALOG_BY_ID.get(decodeURIComponent(id));
  if (!spec) notFound();
  const { user, profile } = await requireProfile();
  const { a, macro, portfolios } = await withUser(user.id, async (tx) => {
    const { assets, macro } = await loadAnalytics(tx, [spec.id], profile.answers.baseCurrency, profile.derived.horizonYears);
    return { a: assets.get(spec.id)!, macro, portfolios: await listPortfolios(tx) };
  });
  const an = a.analytics;
  const op = evaluateOpportunity(spec, an, profile.answers, profile.derived);
  const sc = an.expected?.scenarios;
  const yieldNow = contractualYield(spec, macro);
  const chart = a.md.prices.length > 400 ? a.md.prices.filter((_, i) => i % 2 === 0 || i === a.md.prices.length - 1) : a.md.prices;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/discover" className="hover:underline">← Descobrir</Link>}
        title={spec.name}
        description={spec.description}
        actions={portfolios.length > 0 && (
          <Button asChild variant="brand"><Link href={`/portfolios/${portfolios[0].id}?add=${spec.id}`}><Plus /> Adicionar a um portfólio</Link></Button>
        )}
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{ASSET_CLASS_LABEL[spec.assetClass]}</Badge>
        <Badge variant="outline">Mercado {spec.market} · {spec.currency}</Badge>
        <RiskBadge score={an.risk.score} category={an.risk.category} />
        <CompatibilityBadge value={op.compatibility} />
        <OriginBadge origin={a.md.origin} />
        <DataStatusBadge status={a.md.status} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{spec.pricing === "quoted" ? "Histórico de preços" : "Rendimento contratual"}</CardTitle>
            <CardDescription>Fonte: {a.md.sourceName ?? "—"} · última observação {dateBR(an.lastPriceDate ?? a.md.lastUpdated)} · atualizado {dateTimeBR(a.md.lastUpdated)}</CardDescription>
          </CardHeader>
          <CardContent>
            {spec.pricing === "quoted" ? (
              a.md.prices.length ? <PriceChart data={chart} demo={a.md.origin === "demo"} /> : <p className="text-sm text-muted-foreground">Dados insuficientes: sem série de preços.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label="Taxa contratual atual" value={yieldNow == null ? "—" : `${pct(yieldNow, 2)} a.a.`} hint={spec.yield?.type === "cdi_pct" ? `${(spec.yield.value * 100).toFixed(0)}% do CDI` : spec.yield?.type} />
                <Stat label="Vencimento" value={spec.maturity ? dateBR(spec.maturity) : "Sem vencimento"} />
                <Stat label="Duration aprox." value={spec.duration ? `${num(spec.duration, 1)} anos` : "—"} />
                <p className="text-xs text-muted-foreground sm:col-span-3">Instrumento avaliado pela curva contratual: o valor exibido nas carteiras é <b>estimado</b>, não uma cotação de mercado. Venda antes do vencimento pode ocorrer a preço diferente.</p>
              </div>
            )}
            {a.md.origin === "demo" && spec.pricing === "quoted" && <p className="mt-2 text-xs text-demo">Série SIMULADA para demonstração — não representa o preço real de {spec.symbol}.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Cenários (a.a., {profile.answers.baseCurrency})</CardTitle><CardDescription>Horizonte de {profile.derived.horizonYears} ano(s) · {CMA_METHODOLOGY_VERSION}</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {sc ? (
              <>
                <ScenarioRange {...sc} />
                <div className="grid grid-cols-2 gap-4">
                  <Stat label="Após IR (estim.)" value={an.expected?.afterTaxBase == null ? "—" : pct(an.expected.afterTaxBase)} hint={an.expected?.afterTaxBase == null ? "depende da residência fiscal" : "cenário-base"} />
                  <Stat label="Prob. de perda" value={an.expected?.probabilityOfLoss == null ? "Dados insuficientes" : pct(an.expected.probabilityOfLoss)} />
                </div>
                <p className="text-[11px] text-muted-foreground">{an.expected?.probabilityOfLossNote}</p>
                <div className={`rounded-lg p-3 text-xs ${op.meetsTargetInBase ? "bg-brand-soft text-brand" : "bg-attention-soft text-attention"}`}>
                  {op.meetsTargetInBase ? `Cenário-base igual ou acima da sua meta de ${pct(profile.answers.targetReturn)}.` : `Cenário-base abaixo da sua meta de ${pct(profile.answers.targetReturn)}.`} Projeções não são garantidas nem são dados históricos.
                </div>
              </>
            ) : <p className="text-sm text-muted-foreground">Dados insuficientes para projetar cenários.</p>}
          </CardContent>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Métricas históricas</CardTitle><CardDescription>{an.historical ? `${an.historical.observations} observações, ${dateBR(an.historical.from)} a ${dateBR(an.historical.to)}` : "—"}</CardDescription></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Stat label="Retorno 12 meses" value={an.historical?.return1y == null ? "Dados insuficientes" : pct(an.historical.return1y, 1, true)} hint={a.md.origin === "demo" ? "simulado" : "histórico"} />
            <Stat label="Retorno a.a. (3 anos)" value={an.historical?.cagr3y == null ? "Dados insuficientes" : pct(an.historical.cagr3y, 1, true)} />
            <Stat label="Volatilidade anual" value={an.historical ? pct(an.historical.volatility) : spec.pricing === "accrual" ? `${pct(an.expected?.volatilityUsed)} (duration)` : "Dados insuficientes"} />
            <Stat label="Queda máxima" value={an.historical ? pct(-an.historical.maxDrawdown) : "n/a"} />
            {an.insufficientData.length > 0 && <ul className="col-span-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">{an.insufficientData.map((x) => <li key={x}>{x}</li>)}</ul>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Avaliação de risco</CardTitle><CardDescription>{an.risk.explanation}</CardDescription></CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2.5">
              {an.risk.components.map((c) => <ScoreBar key={c.key} label={RISK_COMPONENT_LABEL[c.key]} score={c.score} note={c.rationale} />)}
            </div>
            <div className="space-y-3 text-sm">
              <div><div className="mb-1 font-medium">Fatores que mais contribuíram</div>
                <ul className="space-y-1.5 text-muted-foreground">{(an.risk.topContributors.length ? an.risk.topContributors : ["Nenhum componente acima de 4/10."]).map((t) => <li key={t}>• {t}</li>)}</ul></div>
              <div><div className="mb-1 font-medium">Limitações</div><ul className="space-y-1 text-xs text-muted-foreground">{an.risk.limitations.map((t) => <li key={t}>• {t}</li>)}</ul></div>
              <p className="text-[11px] text-muted-foreground">Metodologia {an.risk.methodologyVersion}.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Compatibilidade com seu perfil</CardTitle><CardDescription>Perfil {profile.derived.label} · pontuação {op.compatibilityScore}/100</CardDescription></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {op.eligibilityIssues.map((x) => <p key={x} className="flex gap-2 text-critical"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{x}</p>)}
            {op.reasons.map((x) => <p key={x} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand" />{x}</p>)}
            {op.warnings.map((x) => <p key={x} className="flex gap-2 text-attention"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{x}</p>)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Características, custos e acesso</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[150px_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Emissor</dt><dd>{spec.issuer}</dd>
              <dt className="text-muted-foreground">Setor</dt><dd>{spec.sector}</dd>
              <dt className="text-muted-foreground">Liquidez</dt><dd>{spec.lockedUntilMaturity ? `Somente no vencimento (${dateBR(spec.maturity)})` : `Cerca de D+${spec.liquidityDays}`}</dd>
              {spec.minHorizonYears && <><dt className="text-muted-foreground">Horizonte recomendado</dt><dd>{spec.minHorizonYears}+ ano(s)</dd></>}
              <dt className="text-muted-foreground">Custos</dt><dd>{pct(spec.feesAnnual, 2)} a.a.{spec.feeNote ? ` — ${spec.feeNote}` : ""}</dd>
              <dt className="text-muted-foreground">Tributação</dt><dd>{spec.tax.note}</dd>
              <dt className="text-muted-foreground">Crédito</dt><dd>{spec.credit.kind === "none" ? "Sem promessa de pagamento" : `${spec.credit.rating ?? "Sem rating"}${spec.credit.insuredLimit ? ` · ${spec.credit.insuredLimit}` : ""}`}</dd>
              <dt className="text-muted-foreground">Custódia</dt><dd>{spec.counterparty.note}</dd>
              <dt className="text-muted-foreground">Regulação</dt><dd>{spec.regulatory.regulator ?? "—"} — {spec.regulatory.note}</dd>
              {spec.regulatory.eligibility && <><dt className="text-muted-foreground">Elegibilidade</dt><dd>{spec.regulatory.eligibility.map((e) => ELIGIBILITY_LABEL[e]).join(", ")}</dd></>}
              {spec.technology && <><dt className="text-muted-foreground">Tecnologia</dt><dd>{spec.technology.chain} · {spec.technology.audited ? "auditado" : "sem auditoria pública"} — {spec.technology.note}</dd></>}
            </dl>
            <p className="mt-4 text-[11px] text-muted-foreground">Dados cadastrais ilustrativos; confirme taxas, rating e condições na documentação oficial do produto antes de investir.</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader><CardTitle>Metodologia do cenário</CardTitle></CardHeader>
        <CardContent><ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{an.expected?.methodology.map((m) => <li key={m}>{m}</li>)}</ul></CardContent>
      </Card>
    </>
  );
}
