import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { DemoBadge, RiskBadge, SeverityBadge, ValuationBadge } from "@/components/badges";
import { Donut } from "@/components/charts";
import { EmptyState, PageHeader, Stat } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScenarioRange, ScoreBar, WeightBar } from "@/components/viz";
import { CATALOG, CATALOG_BY_ID } from "@/domain/catalog";
import { ASSET_CLASS_SHORT, RISK_COMPONENT_LABEL, type AssetClass } from "@/domain/types";
import { dateBR, dateTimeBR, money, num, pct } from "@/lib/format";
import { requireProfile } from "@/lib/session";
import { cn } from "@/lib/utils";
import { withUser } from "@/server/db";
import { listAlerts } from "@/server/services/monitoring";
import { portfolioView } from "@/server/services/portfolio";
import { PortfolioRowActions } from "../client";
import { AddPosition, EditMeta, FillFromTargets, ImportCsv, PositionActions, TargetsEditor } from "./client";

export const dynamic = "force-dynamic";

export default async function PortfolioPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ add?: string }> }) {
  const { id } = await params;
  const { add } = await searchParams;
  const { user, profile } = await requireProfile();
  const data = await withUser(user.id, async (tx) => {
    const v = await portfolioView(tx, id, profile.derived.horizonYears, false);
    if (!v) return null;
    return { v, alerts: await listAlerts(tx, { portfolioId: id }, 8) };
  });
  if (!data) notFound();
  const { v, alerts } = data;
  const a = v.analytics;
  const base = v.portfolio.base_currency;
  const options = CATALOG.map((s) => ({ id: s.id, label: `${s.symbol} — ${s.name}`, currency: s.currency, pricing: s.pricing, lastPrice: v.assets.get(s.id)?.md.prices.at(-1)?.close ?? null }));

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/portfolios" className="hover:underline">← Portfólios</Link>}
        title={v.portfolio.name}
        description={v.portfolio.description || "Sem descrição."}
        actions={<><EditMeta id={id} name={v.portfolio.name} description={v.portfolio.description} /><PortfolioRowActions id={id} redirectAfterArchive /></>}
      />

      {a ? (
        <div className="space-y-5">
          <Card>
            <CardContent className="grid grid-cols-2 gap-6 p-5 md:grid-cols-4 xl:grid-cols-7">
              <Stat label="Valor total" value={money(a.totalValue, base)} hint={a.demoShare > 0 ? <DemoBadge label={`${Math.round(a.demoShare * 100)}% demo`} /> : undefined} />
              <Stat label="Retorno esperado" value={`${pct(a.expectedReturn)} a.a.`} hint="cenário-base (modelo)" />
              <Stat label="Volatilidade est." value={pct(a.volatility)} />
              <Stat label="Prob. de perda" value={pct(a.probabilityOfLoss)} hint={`em ${a.horizonYears} ano(s)`} />
              <Stat label="Exposição cambial" value={pct(a.fxExposure, 0)} />
              <Stat label="Custo anual" value={pct(a.costs.weightedFee, 2)} hint={money(a.costs.annualCost, base)} />
              <div><div className="text-xs font-medium text-muted-foreground">Risco consolidado</div><div className="mt-1.5"><RiskBadge score={a.risk.score} category={a.risk.category} /></div><div className="mt-1 text-xs text-muted-foreground">Limite do perfil {profile.derived.maxRiskScore}/10</div></div>
            </CardContent>
          </Card>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>Faixa de resultados possíveis</CardTitle><CardDescription>Percentis 10/50/90 anualizados em {a.horizonYears} ano(s), modelo lognormal com correlações. Não é garantia.</CardDescription></CardHeader>
              <CardContent className="space-y-6">
                <ScenarioRange {...a.range} />
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2.5">
                    <div className="text-sm font-medium">Componentes de risco</div>
                    {a.risk.components.map((c) => <ScoreBar key={c.key} label={RISK_COMPONENT_LABEL[c.key]} score={c.score} note={c.rationale} />)}
                  </div>
                  <div className="space-y-3 text-sm">
                    <p className="text-muted-foreground">{a.risk.explanation}</p>
                    <div><div className="font-medium">Principais fatores de risco</div><ul className="mt-1 space-y-1 text-muted-foreground">{a.riskFactors.map((f) => <li key={f}>• {f}</li>)}</ul></div>
                    <div><div className="font-medium">Limitações</div><ul className="mt-1 space-y-1 text-xs text-muted-foreground">{a.risk.limitations.map((f) => <li key={f}>• {f}</li>)}</ul></div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Por classe</CardTitle></CardHeader>
              <CardContent><Donut data={a.byClass.map((g) => ({ name: ASSET_CLASS_SHORT[g.key as AssetClass] ?? g.key, value: g.value }))} /></CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Posições</CardTitle><CardDescription>Valores em {base}. Origem e forma de avaliação explicitadas por linha.</CardDescription></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2">Ativo</th><th className="pb-2 text-right">Quantidade</th><th className="pb-2 text-right">Preço médio</th><th className="pb-2 text-right">Preço atual</th>
                  <th className="pb-2 text-right">Valor ({base})</th><th className="pb-2 text-right">Resultado</th><th className="pb-2">Registro</th><th className="pb-2">Avaliação</th><th className="pb-2" />
                </tr></thead>
                <tbody>
                  {v.positions.map((p) => {
                    const s = CATALOG_BY_ID.get(p.asset_id)!;
                    return (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="py-2.5"><Link href={`/assets/${p.asset_id}`} className="font-medium hover:underline">{s.symbol}</Link><div className="text-xs text-muted-foreground">{ASSET_CLASS_SHORT[s.assetClass]} · desde {dateBR(p.acquired_at)}</div></td>
                        <td className="text-right tabular">{num(p.quantity, 6)}</td>
                        <td className="text-right tabular">{money(p.avg_price, s.currency, p.avg_price < 10 ? 4 : 2)}</td>
                        <td className="text-right tabular">{p.price == null ? "—" : money(p.price, s.currency, p.price < 10 ? 4 : 2)}</td>
                        <td className="text-right font-medium tabular">{money(p.valueBase, base)}</td>
                        <td className={cn("text-right tabular", p.pnlBase >= 0 ? "text-positive" : "text-negative")}>{money(p.pnlBase, base)}<div className="text-[11px]">{pct(p.costBase ? p.pnlBase / p.costBase : null, 1, true)}</div></td>
                        <td><span className="text-xs">{p.origin === "manual" ? "Manual" : "Importado"}</span></td>
                        <td><ValuationBadge valuation={p.valuation} /></td>
                        <td className="text-right"><PositionActions portfolioId={id} position={{ id: p.id, quantity: p.quantity, avgPrice: p.avg_price, acquiredAt: p.acquired_at, manualValue: p.manual_value, notes: p.notes }} label={s.symbol} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-3 text-[11px] text-muted-foreground">Resultado = valor atual − custo (quantidade × preço médio), convertido pelo câmbio atual. Renda fixa avaliada pela curva contratual (estimado). Valores de demonstração são simulados.</p>
            </CardContent>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Alocação atual vs. alvo</CardTitle><CardDescription>Desvios ≥ 5 p.p. geram alerta no monitoramento.</CardDescription></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-2">Ativo</th><th className="pb-2 text-right">Atual</th><th className="pb-2 text-right">Alvo</th><th className="pb-2 text-right">Desvio</th><th className="pb-2 text-right">Risco</th></tr></thead>
                  <tbody>
                    {a.holdings.map((h) => (
                      <tr key={h.assetId} className="border-t">
                        <td className="py-1.5">{h.symbol}</td><td className="text-right tabular">{pct(h.weight)}</td><td className="text-right tabular">{h.targetWeight == null ? "—" : pct(h.targetWeight)}</td>
                        <td className={cn("text-right tabular", h.drift != null && Math.abs(h.drift) >= 0.05 && "font-semibold text-attention")}>{h.drift == null ? "—" : pct(h.drift, 1, true)}</td>
                        <td className="text-right"><RiskBadge score={h.riskScore} compact /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Liquidez, concentração e testes de estresse</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                <div><div className="mb-2 text-sm font-medium">Liquidez consolidada</div><WeightBar items={[{ label: "até D+1", weight: a.liquidity.d1 }, { label: "D+2 a D+5", weight: a.liquidity.d5 }, { label: "até D+30", weight: a.liquidity.d30 }, { label: "> 30 dias / vencimento", weight: a.liquidity.beyond }]} /></div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <Stat label="Maior emissor" value={a.concentration.topIssuer ? pct(a.concentration.topIssuer.weight, 0) : "—"} hint={a.concentration.topIssuer?.key} />
                  <Stat label="HHI emissor / setor / país / moeda" value={`${a.concentration.issuerHHI.toFixed(2)} / ${a.concentration.sectorHHI.toFixed(2)}`} hint={`${a.concentration.countryHHI.toFixed(2)} / ${a.concentration.currencyHHI.toFixed(2)}`} />
                </div>
                <table className="w-full text-sm">
                  <tbody>{a.stress.map((s) => <tr key={s.id} className="border-t"><td className="py-1.5" title={s.description}>{s.label}</td><td className="text-right tabular text-negative">{pct(s.impact)}</td><td className="pl-2 text-right text-xs tabular text-muted-foreground">{money(s.impact * a.totalValue, base)}</td></tr>)}</tbody>
                </table>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Correlação entre ativos</CardTitle><CardDescription>Histórica (≥120 retornos em comum, mesma moeda) ou premissa por classe (itálico).</CardDescription></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="text-[11px] tabular">
                <thead><tr><th />{a.correlation.assets.map((s) => <th key={s} className="px-1 font-medium [writing-mode:vertical-rl]">{s}</th>)}</tr></thead>
                <tbody>{a.correlation.matrix.map((row, i) => (
                  <tr key={i}><th className="pr-2 text-left font-medium">{a.correlation.assets[i]}</th>
                    {row.map((c, j) => <td key={j} className={cn("h-7 w-10 text-center", a.correlation.source[i][j] === "premissa" && "italic")} style={{ background: `hsl(${(c ?? 0) >= 0 ? "172 70% 30%" : "0 72% 48%"} / ${Math.abs(c ?? 0) * 0.55})` }}>{c == null ? "" : c.toFixed(2)}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      ) : (
        <EmptyState title="Portfólio sem posições" description="Adicione posições manualmente, importe um CSV ou gere posições a partir da alocação-alvo." />
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <AddPosition portfolioId={id} options={options} preselect={add} />
        <div className="space-y-5">
          <ImportCsv portfolioId={id} />
          {v.targets.length > 0 && <FillFromTargets portfolioId={id} currency={base} />}
        </div>
      </div>

      <div className="mt-5">
        <TargetsEditor portfolioId={id} options={options} initial={v.targets.map((t) => ({ assetId: t.asset_id, weight: t.weight }))} />
      </div>

      <Card className="mt-5">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2"><div><CardTitle>Alertas deste portfólio</CardTitle></div><Link href="/alerts" className="text-sm underline">Central de alertas</Link></CardHeader>
        <CardContent>
          {alerts.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum alerta registrado.</p> : (
            <ul className="divide-y">{alerts.map((al) => (
              <li key={al.id}><Link href={`/alerts/${al.id}`} className="flex items-center gap-3 py-2 hover:opacity-80"><AlertTriangle className="h-4 w-4 text-muted-foreground" /><span className="flex-1 truncate text-sm">{al.title}</span><span className="text-xs text-muted-foreground">{dateTimeBR(al.analyzed_at)}</span><SeverityBadge severity={al.severity} /></Link></li>
            ))}</ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
