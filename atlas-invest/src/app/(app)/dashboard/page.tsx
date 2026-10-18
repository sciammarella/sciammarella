import Link from "next/link";
import { AlertTriangle, ArrowRight, Briefcase, CalendarClock, Compass, Plus } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { CompatibilityBadge, DemoBadge, OriginBadge, RiskBadge, SeverityBadge } from "@/components/badges";
import { Donut, PerformanceChart } from "@/components/charts";
import { EmptyState, PageHeader, Stat } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Gauge, ScenarioRange, WeightBar } from "@/components/viz";
import { runMonitoringAction } from "@/app/actions";
import { addDays } from "@/domain/calendar";
import { ASSET_CLASS_SHORT, type AssetClass } from "@/domain/types";
import { dateBR, dateTimeBR, money, pct } from "@/lib/format";
import { requireProfile } from "@/lib/session";
import { withUser } from "@/server/db";
import { discover } from "@/server/services/discovery";
import { listAlerts, listRuns } from "@/server/services/monitoring";
import { listPortfolios, portfolioView } from "@/server/services/portfolio";
import { todayISO } from "@/server/services/market-data";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { user, profile } = await requireProfile();
  const sp = await searchParams;
  const base = profile.answers.baseCurrency;
  const data = await withUser(user.id, async (tx) => {
    const portfolios = await listPortfolios(tx);
    const views = [];
    for (const p of portfolios) views.push({ p, v: await portfolioView(tx, p.id, profile.derived.horizonYears, p.id === (sp.p ?? portfolios[0]?.id)) });
    const { items } = await discover(tx, profile);
    const alerts = await listAlerts(tx, { status: "open" }, 6);
    const [lastRun] = await listRuns(tx, 1);
    return { portfolios, views, opportunities: items.filter((i) => i.opportunity.eligible && i.opportunity.compatibility !== "incompatível").slice(0, 4), alerts, lastRun };
  });

  if (data.portfolios.length === 0) {
    return (
      <>
        <PageHeader title={`Olá, ${user.displayName.split(" ")[0]}`} description={`Perfil ${profile.derived.label} · meta de ${pct(profile.answers.targetReturn)} a.a.`} />
        <EmptyState icon={<Briefcase className="h-8 w-8" />} title="Você ainda não tem portfólios"
          description="Crie um portfólio a partir das propostas do Portfolio Builder ou registre suas posições manualmente."
          action={<div className="flex gap-2"><Button asChild variant="brand"><Link href="/builder">Abrir Portfolio Builder</Link></Button><Button asChild variant="outline"><Link href="/portfolios">Criar portfólio vazio</Link></Button></div>} />
      </>
    );
  }

  const selected = data.views.find((x) => x.p.id === sp.p) ?? data.views[0];
  const v = selected.v!;
  const a = v.analytics;
  const totalAll = data.views.reduce((s, x) => s + (x.v?.analytics?.totalValue ?? 0), 0);
  const hasCritical = data.alerts.some((x) => x.severity === "critical");
  const profileReview = addDays(profile.updatedAt.slice(0, 10), 90);
  const nextReview = hasCritical ? todayISO() : profileReview < addDays(todayISO(), 30) ? profileReview : addDays(todayISO(), 30);

  return (
    <>
      <PageHeader
        eyebrow={`Perfil ${profile.derived.label} · meta ${pct(profile.answers.targetReturn)} a.a. · horizonte ${profile.derived.horizonYears} ano(s)`}
        title={`Olá, ${user.displayName.split(" ")[0]}`}
        actions={
          <>
            <ActionButton variant="outline" action={runMonitoringAction} pendingLabel="Monitorando…">Executar monitoramento</ActionButton>
            <Button asChild variant="brand"><Link href="/builder"><Plus /> Novo portfólio</Link></Button>
          </>
        }
      />

      {/* Portfolio switcher */}
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {data.views.map(({ p, v: pv }) => (
          <Link key={p.id} href={`/dashboard?p=${p.id}`} className={cn("shrink-0 rounded-xl border px-4 py-2.5 text-sm transition", p.id === selected.p.id ? "border-foreground bg-primary text-primary-foreground" : "bg-card hover:border-foreground/30")}>
            <div className="font-medium">{p.name}</div>
            <div className={cn("text-xs tabular", p.id === selected.p.id ? "text-primary-foreground/70" : "text-muted-foreground")}>{money(pv?.analytics?.totalValue ?? 0, p.base_currency)} · {p.positions} posições</div>
          </Link>
        ))}
      </div>

      {!a ? (
        <EmptyState title="Portfólio sem posições" description="Adicione posições manualmente ou importe um CSV para ver indicadores." action={<Button asChild><Link href={`/portfolios/${selected.p.id}`}>Adicionar posições</Link></Button>} />
      ) : (
        <div className="space-y-5">
          <Card>
            <CardContent className="grid grid-cols-2 gap-6 p-5 md:grid-cols-3 xl:grid-cols-6">
              <Stat label="Patrimônio monitorado (todos)" value={money(totalAll, base)} hint={`${data.portfolios.length} portfólio(s)`} />
              <Stat label={`Valor — ${selected.p.name}`} value={money(a.totalValue, base)} hint={a.demoShare > 0 ? <span className="inline-flex items-center gap-1"><DemoBadge label={`${Math.round(a.demoShare * 100)}% demo`} /></span> : "Cotações reais/estimadas"} />
              <Stat label="Variação 1 dia" value={pct(v.changes.d1, 2, true)} accent={v.changes.d1 == null ? null : v.changes.d1 >= 0 ? "positive" : "negative"} hint="Simulada*" />
              <Stat label="Variação 30 dias" value={pct(v.changes.d30, 1, true)} accent={v.changes.d30 == null ? null : v.changes.d30 >= 0 ? "positive" : "negative"} hint="Simulada*" />
              <Stat label="Variação 12 meses" value={pct(v.changes.d365, 1, true)} accent={v.changes.d365 == null ? null : v.changes.d365 >= 0 ? "positive" : "negative"} hint="Simulada*" />
              <div>
                <div className="text-xs font-medium text-muted-foreground">Risco da carteira</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-3"><Gauge score={a.risk.score} max={profile.derived.maxRiskScore} /><RiskBadge score={a.risk.score} compact /></div>
                <div className="mt-1 text-xs text-muted-foreground">Limite do perfil: {profile.derived.maxRiskScore}/10</div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>Rentabilidade acumulada vs. benchmarks</CardTitle>
                <CardDescription>* Desempenho simulado da composição atual nos últimos 12 meses (quantidades e câmbio constantes; base 100). Não é rentabilidade realizada.</CardDescription>
              </CardHeader>
              <CardContent>
                <PerformanceChart data={v.history as never} series={[
                  { key: "portfolio", label: selected.p.name, color: "hsl(172 70% 30%)" },
                  { key: "cdi", label: base === "BRL" ? "CDI" : "T-Bill", color: "hsl(210 15% 55%)" },
                  { key: "ibov", label: "Ibovespa (BOVA11)", color: "hsl(38 90% 50%)" },
                  { key: "sp500", label: "S&P 500 (VOO, USD)", color: "hsl(224 60% 45%)" },
                ]} />
                {a.demoShare > 0 && <p className="mt-2 text-xs text-demo">Séries de preço de demonstração (simuladas) usadas em {pct(a.demoShare, 0)} da carteira e nos benchmarks sem fonte real.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Indicadores-chave</CardTitle><CardDescription>Horizonte de {a.horizonYears} ano(s)</CardDescription></CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <div className="mb-2 flex items-baseline justify-between text-sm"><span className="text-muted-foreground">Retorno esperado (a.a.)</span><span className="font-semibold tabular">{pct(a.expectedReturn)}</span></div>
                  <ScenarioRange {...a.range} />
                  <div className="mt-1 text-[11px] text-muted-foreground">Estimativa de modelo ({base}); não é garantia. Prob. de perda nominal no horizonte: {pct(a.probabilityOfLoss)}.</div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Stat label="Exposição cambial" value={pct(a.fxExposure, 0)} hint={`fora de ${base}`} />
                  <Stat label="Liquidez até D+5" value={pct(a.liquidity.d1 + a.liquidity.d5, 0)} hint={`mín. do perfil ${pct(profile.derived.minLiquidWeight, 0)}`} />
                  <Stat label="Volatilidade est." value={pct(a.volatility)} hint="anualizada" />
                  <Stat label="Custo médio" value={pct(a.costs.weightedFee, 2)} hint={`${money(a.costs.annualCost, base)}/ano`} />
                </div>
                <div className="rounded-lg bg-muted p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium"><CalendarClock className="h-4 w-4" /> Próxima revisão recomendada: {dateBR(nextReview)}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{hasCritical ? "Há alertas críticos em aberto — revise hoje." : `Monitor diário automático; revisão do perfil a cada 90 dias (perfil atualizado em ${dateBR(profile.updatedAt)}).`}</div>
                  {data.lastRun && <div className="mt-1 text-xs text-muted-foreground">Último monitoramento: {dateTimeBR(data.lastRun.started_at)} ({data.lastRun.trigger === "scheduled" ? "agendado" : "manual"})</div>}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card><CardHeader><CardTitle>Por classe de ativo</CardTitle></CardHeader><CardContent><Donut data={a.byClass.map((g) => ({ name: ASSET_CLASS_SHORT[g.key as AssetClass] ?? g.key, value: g.value }))} /></CardContent></Card>
            <Card><CardHeader><CardTitle>Por país</CardTitle></CardHeader><CardContent><Donut data={a.byMarket.map((g) => ({ name: g.key, value: g.value }))} /></CardContent></Card>
            <Card><CardHeader><CardTitle>Por moeda</CardTitle></CardHeader><CardContent><Donut data={a.byCurrency.map((g) => ({ name: g.key, value: g.value }))} /></CardContent></Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Origem dos valores</CardTitle><CardDescription>Patrimônio informado manualmente, importado e estimado — separados para transparência.</CardDescription></CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2">
              <div><div className="mb-2 text-sm font-medium">Como a posição foi registrada</div><WeightBar items={a.byOrigin.map((g) => ({ label: g.key, weight: g.weight }))} /></div>
              <div><div className="mb-2 text-sm font-medium">Como o valor foi obtido</div><WeightBar items={a.byValuation.map((g) => ({ label: g.key, weight: g.weight }))} /></div>
            </CardContent>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                <div><CardTitle>Alertas que exigem atenção</CardTitle><CardDescription>Em aberto, todos os portfólios</CardDescription></div>
                <Button asChild size="sm" variant="ghost"><Link href="/alerts">Ver todos <ArrowRight /></Link></Button>
              </CardHeader>
              <CardContent>
                {data.alerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum alerta em aberto. O monitor diário avisará quando algo relevante mudar.</p>
                ) : (
                  <ul className="divide-y">
                    {data.alerts.map((al) => (
                      <li key={al.id}><Link href={`/alerts/${al.id}`} className="flex items-start gap-3 py-2.5 hover:opacity-80">
                        <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", al.severity === "critical" ? "text-critical" : al.severity === "attention" ? "text-attention" : "text-info")} />
                        <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{al.title}</div><div className="truncate text-xs text-muted-foreground">{al.portfolio_name} · {dateTimeBR(al.analyzed_at)}</div></div>
                        <div className="flex shrink-0 gap-1">{al.uses_demo_data && <DemoBadge />}<SeverityBadge severity={al.severity} /></div>
                      </Link></li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                <div><CardTitle>Principais oportunidades</CardTitle><CardDescription>Compatíveis com seu perfil</CardDescription></div>
                <Button asChild size="sm" variant="ghost"><Link href="/discover"><Compass /> Descobrir</Link></Button>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {data.opportunities.map((o) => (
                    <li key={o.spec.id}><Link href={`/assets/${o.spec.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                      <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{o.spec.name}</div><div className="text-xs text-muted-foreground">{ASSET_CLASS_SHORT[o.spec.assetClass]} · base {pct(o.analytics.expected?.scenarios.base)} a.a.</div></div>
                      <div className="flex shrink-0 items-center gap-1.5"><OriginBadge origin={o.md.origin} /><RiskBadge score={o.analytics.risk.score} compact /><span className="hidden sm:inline"><CompatibilityBadge value={o.opportunity.compatibility} /></span></div>
                    </Link></li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
