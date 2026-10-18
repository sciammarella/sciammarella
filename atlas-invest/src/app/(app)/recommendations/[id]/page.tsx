import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfidenceBadge, DemoBadge } from "@/components/badges";
import { Markdown } from "@/components/markdown";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { dateBR, dateTimeBR, pct } from "@/lib/format";
import { requireProfile } from "@/lib/session";
import { withUser } from "@/server/db";
import { getRecommendation } from "@/server/services/recommendations";

export const dynamic = "force-dynamic";

export default async function RecommendationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireProfile();
  const data = await withUser(user.id, (tx) => getRecommendation(tx, id));
  if (!data) notFound();
  const { rec, evidence } = data;
  const body = rec.body as { markdown?: string; feasibility?: { message: string }; proposals?: { label: string; compatible: boolean; metrics: { expectedReturn: number; risk: { score: number } } | null }[]; toolCalls?: { name: string; error: string | null }[] };
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/recommendations" className="hover:underline">← Histórico de recomendações</Link>}
        title={rec.title}
        actions={rec.kind === "portfolio_proposal" ? <Button asChild variant="outline"><Link href={`/builder?rec=${rec.id}`}>Abrir no Portfolio Builder</Link></Button> : undefined}
      />
      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
        <ConfidenceBadge value={rec.confidence} />
        <Badge variant="outline">Pontuação de confiança {rec.confidence_score}/100</Badge>
        {rec.uses_demo_data && <DemoBadge label="usa dados demo" />}
        <span className="text-muted-foreground">Gerado em {dateTimeBR(rec.created_at)} por {rec.generator === "rules" ? "motor de regras determinístico" : rec.generator} · dados até {dateBR(rec.data_as_of)}</span>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Justificativa</CardTitle><CardDescription>{rec.summary}</CardDescription></CardHeader>
          <CardContent>
            {body.markdown && <Markdown source={body.markdown} />}
            {body.proposals && (
              <div className="space-y-2 text-sm">
                <p>{body.feasibility?.message}</p>
                <ul className="list-disc pl-5">{body.proposals.map((p) => <li key={p.label}>{p.label}: {p.metrics ? `retorno esperado ${pct(p.metrics.expectedReturn)} a.a., risco ${p.metrics.risk.score}/10` : "sem métricas"} — {p.compatible ? "compatível" : "fora do perfil"}</li>)}</ul>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Metodologias</CardTitle></CardHeader>
          <CardContent><dl className="grid grid-cols-[90px_1fr] gap-y-1 text-sm">{Object.entries(rec.methodology_versions).map(([k, v]) => <Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="font-mono text-xs leading-5">{v}</dd></Fragment>)}</dl>
            {body.toolCalls && <div className="mt-4"><div className="text-sm font-medium">Ferramentas usadas pelo agente</div><ul className="mt-1 text-xs text-muted-foreground">{body.toolCalls.map((t, i) => <li key={i}>• {t.name}{t.error ? ` — erro: ${t.error}` : ""}</li>)}</ul></div>}
          </CardContent>
        </Card>
      </div>
      <Card className="mt-5">
        <CardHeader><CardTitle>Evidências ({evidence.length})</CardTitle><CardDescription>Dados estruturados usados na recomendação, com fonte e data.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {evidence.map((e) => (
            <details key={e.id} className="rounded-lg border p-3">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm"><span className="font-medium">{e.label}</span><span className="text-xs text-muted-foreground">{e.source} · {e.data_as_of ? (e.data_as_of.length > 10 ? dateTimeBR(e.data_as_of) : dateBR(e.data_as_of)) : "—"}</span>{e.is_demo && <DemoBadge />}</summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted p-3 text-[11px]">{JSON.stringify(e.value, null, 2)}</pre>
            </details>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
