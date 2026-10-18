import Link from "next/link";
import { AlertTriangle, CheckCircle2, Sparkles, XCircle } from "lucide-react";
import { ConfidenceBadge, DemoBadge, RiskBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScenarioRange } from "@/components/viz";
import { CATALOG_BY_ID } from "@/domain/catalog";
import type { FeasibilityResult, Strategy } from "@/domain/builder";
import type { PortfolioAnalytics } from "@/domain/portfolio";
import { ASSET_CLASS_SHORT, type AssetClass } from "@/domain/types";
import { dateTimeBR, money, pct } from "@/lib/format";
import { requireProfile } from "@/lib/session";
import { cn } from "@/lib/utils";
import { withUser } from "@/server/db";
import { getRecommendation, listRecommendations } from "@/server/services/recommendations";
import { GenerateForm, SaveProposal } from "./client";

export const dynamic = "force-dynamic";

type ProposalBody = {
  amount: number;
  baseCurrency: "BRL" | "USD";
  feasibility: FeasibilityResult;
  recommendedStrategy: Strategy | null;
  proposals: {
    strategy: Strategy; label: string; compatible: boolean; compatibilityNotes: string[]; notes: string[];
    lines: { assetId: string; weight: number; rationale: string; sleeve: string }[];
    metrics: Pick<PortfolioAnalytics, "expectedReturn" | "volatility" | "range" | "probabilityOfLoss" | "risk" | "liquidity" | "costs" | "stress" | "byClass" | "byCurrency" | "byMarket" | "bySector" | "byIssuer" | "concentration" | "correlation" | "riskFactors" | "fxExposure"> | null;
  }[];
  disclaimer: string;
};

export default async function BuilderPage({ searchParams }: { searchParams: Promise<{ rec?: string }> }) {
  const { user, profile } = await requireProfile();
  const { rec: recId } = await searchParams;
  const { rec, recent } = await withUser(user.id, async (tx) => {
    const recs = (await listRecommendations(tx, 50)).filter((r) => r.kind === "portfolio_proposal");
    const id = recId ?? recs[0]?.id;
    return { rec: id ? await getRecommendation(tx, id) : null, recent: recs.slice(0, 5) };
  });
  const body = rec?.rec.body as ProposalBody | undefined;
  const cur = profile.answers.baseCurrency;

  return (
    <>
      <PageHeader
        eyebrow="Portfolio Builder"
        title="Montar portfólio a partir do seu objetivo"
        description={<>Geramos três alternativas comparáveis respeitando o perfil <b>{profile.derived.label}</b>. A meta de {pct(profile.answers.targetReturn)} a.a. é avaliada, mas nunca usada para aumentar o risco. Alocações são propostas analíticas — não ordens.</>}
      />
      <Card className="mb-5"><CardContent className="p-5"><GenerateForm defaultAmount={profile.answers.amount} currency={cur} /></CardContent></Card>

      {!body ? (
        <div className="rounded-2xl border border-dashed p-12 text-center text-sm text-muted-foreground"><Sparkles className="mx-auto mb-3 h-8 w-8" />Gere as propostas para comparar as três alternativas.</div>
      ) : (
        <>
          <div className={cn("mb-5 flex gap-3 rounded-2xl border p-4", body.feasibility.status === "compatível" ? "border-brand/30 bg-brand-soft" : body.feasibility.status === "desafiadora" ? "border-attention/30 bg-attention-soft" : "border-critical/30 bg-critical-soft")}>
            {body.feasibility.status === "compatível" ? <CheckCircle2 className="h-5 w-5 shrink-0 text-brand" /> : body.feasibility.status === "desafiadora" ? <AlertTriangle className="h-5 w-5 shrink-0 text-attention" /> : <XCircle className="h-5 w-5 shrink-0 text-critical" />}
            <div className="text-sm">
              <div className="font-semibold">Meta {body.feasibility.status}</div>
              <p className="mt-0.5">{body.feasibility.message}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>Gerado em {dateTimeBR(rec!.rec.created_at)} para {money(body.amount, cur)}</span>
                <ConfidenceBadge value={rec!.rec.confidence} />
                {rec!.rec.uses_demo_data && <DemoBadge label="usa dados demo" />}
                <Link href={`/recommendations/${rec!.rec.id}`} className="underline">Ver evidências</Link>
              </div>
            </div>
          </div>

          {/* Side-by-side comparison */}
          <div className="grid gap-5 xl:grid-cols-3">
            {body.proposals.map((p) => {
              const m = p.metrics;
              const worst = m ? [...m.stress].sort((a, b) => a.impact - b.impact)[0] : null;
              return (
                <Card key={p.strategy} className={cn(body.recommendedStrategy === p.strategy && "ring-2 ring-brand")}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>{p.label}</CardTitle>
                      <div className="flex gap-1.5">
                        {body.recommendedStrategy === p.strategy && <Badge variant="brand">Sugerida</Badge>}
                        <Badge variant={p.compatible ? "brand" : "critical"}>{p.compatible ? "Compatível" : "Fora do perfil"}</Badge>
                      </div>
                    </div>
                    <CardDescription>{p.compatibilityNotes.join(" ")}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {m && (
                      <>
                        <div>
                          <div className="mb-1.5 flex justify-between text-sm"><span className="text-muted-foreground">Retorno esperado</span><span className="font-semibold tabular">{pct(m.expectedReturn)} a.a.</span></div>
                          <ScenarioRange {...m.range} />
                        </div>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                          <dt className="text-muted-foreground">Risco consolidado</dt><dd className="text-right"><RiskBadge score={m.risk.score} category={m.risk.category} /></dd>
                          <dt className="text-muted-foreground">Volatilidade</dt><dd className="text-right tabular">{pct(m.volatility)}</dd>
                          <dt className="text-muted-foreground">Prob. de perda</dt><dd className="text-right tabular">{pct(m.probabilityOfLoss)}</dd>
                          <dt className="text-muted-foreground">Pior estresse</dt><dd className="text-right tabular text-negative">{worst ? pct(worst.impact) : "—"}</dd>
                          <dt className="text-muted-foreground">Liquidez até D+5</dt><dd className="text-right tabular">{pct(m.liquidity.d1 + m.liquidity.d5, 0)}</dd>
                          <dt className="text-muted-foreground">Exposição cambial</dt><dd className="text-right tabular">{pct(m.fxExposure, 0)}</dd>
                          <dt className="text-muted-foreground">Custo estimado</dt><dd className="text-right tabular">{pct(m.costs.weightedFee, 2)} · {money(m.costs.annualCost, cur)}/ano</dd>
                          <dt className="text-muted-foreground">Maior emissor</dt><dd className="truncate text-right">{m.concentration.topIssuer ? `${m.concentration.topIssuer.key} (${pct(m.concentration.topIssuer.weight, 0)})` : "—"}</dd>
                        </dl>
                      </>
                    )}
                    <div>
                      <div className="mb-2 text-sm font-medium">Alocação</div>
                      <ul className="space-y-1.5">
                        {p.lines.map((l) => {
                          const s = CATALOG_BY_ID.get(l.assetId);
                          return (
                            <li key={l.assetId} className="text-sm" title={l.rationale}>
                              <div className="flex items-center justify-between gap-2">
                                <Link href={`/assets/${l.assetId}`} className="truncate hover:underline">{s?.symbol ?? l.assetId}</Link>
                                <span className="tabular font-medium">{pct(l.weight)}</span>
                              </div>
                              <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-brand" style={{ width: `${l.weight * 100}%` }} /></div>
                              <div className="mt-0.5 text-[11px] text-muted-foreground">{l.rationale}</div>
                            </li>
                          );
                        })}
                      </ul>
                      {p.notes.length > 0 && <ul className="mt-3 space-y-1 text-xs text-muted-foreground">{p.notes.map((n) => <li key={n}>• {n}</li>)}</ul>}
                    </div>
                    <SaveProposal recommendationId={rec!.rec.id} strategy={p.strategy} label={p.label} amount={body.amount} currency={cur} compatible={p.compatible} />
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Detail tables */}
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Testes de estresse</CardTitle><CardDescription>Impacto estimado no valor da carteira ({cur}), choques instantâneos.</CardDescription></CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-2">Cenário</th>{body.proposals.map((p) => <th key={p.strategy} className="pb-2 text-right">{p.label}</th>)}</tr></thead>
                  <tbody>
                    {body.proposals[0].metrics?.stress.map((s, i) => (
                      <tr key={s.id} className="border-t"><td className="py-2" title={s.description}>{s.label}</td>{body.proposals.map((p) => <td key={p.strategy} className="py-2 text-right tabular text-negative">{p.metrics ? pct(p.metrics.stress[i].impact) : "—"}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Distribuição por classe e moeda</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-2">Exposição</th>{body.proposals.map((p) => <th key={p.strategy} className="pb-2 text-right">{p.label}</th>)}</tr></thead>
                  <tbody>
                    {[...new Set(body.proposals.flatMap((p) => p.metrics?.byClass.map((c) => c.key) ?? []))].map((k) => (
                      <tr key={k} className="border-t"><td className="py-1.5">{ASSET_CLASS_SHORT[k as AssetClass] ?? k}</td>{body.proposals.map((p) => <td key={p.strategy} className="py-1.5 text-right tabular">{pct(p.metrics?.byClass.find((c) => c.key === k)?.weight ?? 0, 0)}</td>)}</tr>
                    ))}
                    {["BRL", "USD"].map((c) => (
                      <tr key={c} className="border-t bg-muted/40"><td className="py-1.5">Moeda {c}</td>{body.proposals.map((p) => <td key={p.strategy} className="py-1.5 text-right tabular">{pct(p.metrics?.byCurrency.find((x) => x.key === c)?.weight ?? 0, 0)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {body.proposals.filter((p) => p.metrics).slice(1, 2).map((p) => (
              <Card key={p.strategy}>
                <CardHeader><CardTitle>Correlação — {p.label}</CardTitle><CardDescription>Histórica quando há ≥120 retornos em comum na mesma moeda; caso contrário, premissa por classe (itálico).</CardDescription></CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="text-[11px] tabular">
                    <thead><tr><th />{p.metrics!.correlation.assets.map((s) => <th key={s} className="px-1 font-medium [writing-mode:vertical-rl]">{s}</th>)}</tr></thead>
                    <tbody>
                      {p.metrics!.correlation.matrix.map((row, i) => (
                        <tr key={i}><th className="pr-2 text-left font-medium">{p.metrics!.correlation.assets[i]}</th>
                          {row.map((c, j) => <td key={j} className={cn("h-7 w-9 text-center", p.metrics!.correlation.source[i][j] === "premissa" && "italic")} style={{ background: `hsl(${(c ?? 0) >= 0 ? "172 70% 30%" : "0 72% 48%"} / ${Math.abs(c ?? 0) * 0.55})` }}>{c == null ? "" : c.toFixed(2)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            ))}
            <Card>
              <CardHeader><CardTitle>Principais fatores de risco</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {body.proposals.map((p) => (
                  <div key={p.strategy}><div className="text-sm font-medium">{p.label}</div><ul className="mt-1 space-y-1 text-xs text-muted-foreground">{p.metrics?.riskFactors.slice(0, 4).map((f) => <li key={f}>• {f}</li>)}</ul></div>
                ))}
              </CardContent>
            </Card>
          </div>
          <p className="mt-5 text-xs text-muted-foreground">{body.disclaimer}</p>
        </>
      )}

      {recent.length > 1 && (
        <div className="mt-8">
          <div className="mb-2 text-sm font-medium">Propostas anteriores</div>
          <div className="flex flex-wrap gap-2">{recent.map((r) => <Link key={r.id} href={`/builder?rec=${r.id}`} className={cn("rounded-lg border px-3 py-1.5 text-xs", r.id === rec?.rec.id ? "bg-primary text-primary-foreground" : "bg-card")}>{dateTimeBR(r.created_at)}</Link>)}</div>
        </div>
      )}
    </>
  );
}
