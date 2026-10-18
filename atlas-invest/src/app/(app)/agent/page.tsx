import Link from "next/link";
import { Bot } from "lucide-react";
import { ConfidenceBadge, DemoBadge } from "@/components/badges";
import { Markdown } from "@/components/markdown";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { dateTimeBR } from "@/lib/format";
import { requireProfile } from "@/lib/session";
import { pickProvider } from "@/server/ai/providers";
import { withUser } from "@/server/db";
import { listPortfolios } from "@/server/services/portfolio";
import { getRecommendation, listRecommendations } from "@/server/services/recommendations";
import { AgentForm } from "./client";

export const dynamic = "force-dynamic";

export default async function AgentPage({ searchParams }: { searchParams: Promise<{ rec?: string }> }) {
  const { user } = await requireProfile();
  const sp = await searchParams;
  const { portfolios, latest, history } = await withUser(user.id, async (tx) => {
    const reports = (await listRecommendations(tx, 100)).filter((r) => r.kind === "agent_report");
    const id = sp.rec ?? reports[0]?.id;
    return { portfolios: await listPortfolios(tx), latest: id ? await getRecommendation(tx, id) : null, history: reports.slice(0, 8) };
  });
  const provider = pickProvider();
  const body = latest?.rec.body as { markdown?: string } | undefined;
  return (
    <>
      <PageHeader
        eyebrow="AI Investment Agent"
        title="Agente de análise"
        description={<>O agente consulta ferramentas determinísticas (perfil, métricas da carteira, descoberta, comparação, alertas) e explica os resultados. {provider ? <>Modelo: <b>Claude ({process.env.ANTHROPIC_MODEL || "claude-opus-5-5"})</b>.</> : <>Nenhuma chave de IA configurada — usando o <b>analista por regras</b> (mesmas ferramentas, texto em modelo fixo).</>}</>}
      />
      <Card className="mb-5"><CardContent className="p-5"><AgentForm portfolios={portfolios.map((p) => ({ id: p.id, name: p.name }))} llm={!!provider} /></CardContent></Card>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Bot className="h-4 w-4" /> {latest ? latest.rec.title : "Nenhum relatório ainda"}</CardTitle>
            {latest && <CardDescription className="flex flex-wrap items-center gap-2">{dateTimeBR(latest.rec.created_at)} · <ConfidenceBadge value={latest.rec.confidence} /> {latest.rec.uses_demo_data && <DemoBadge label="dados demo" />} <Link href={`/recommendations/${latest.rec.id}`} className="underline">Evidências ({latest.evidence.length})</Link></CardDescription>}
          </CardHeader>
          <CardContent>{body?.markdown ? <Markdown source={body.markdown} /> : <p className="text-sm text-muted-foreground">Gere um relatório de revisão ou faça uma pergunta.</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Relatórios anteriores</CardTitle></CardHeader>
          <CardContent><ul className="space-y-2">{history.map((h) => <li key={h.id}><Link href={`/agent?rec=${h.id}`} className="block rounded-lg border p-2.5 text-sm hover:bg-muted"><div className="truncate font-medium">{h.title}</div><div className="text-xs text-muted-foreground">{dateTimeBR(h.created_at)} · {h.generator === "rules" ? "regras" : "Claude"}</div></Link></li>)}</ul>
            {history.length === 0 && <p className="text-sm text-muted-foreground">—</p>}</CardContent>
        </Card>
      </div>
    </>
  );
}
