import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { DemoBadge, SeverityBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setAlertStatusAction } from "@/app/actions";
import { CATALOG_BY_ID } from "@/domain/catalog";
import { OBJECTIVE_LABEL } from "@/domain/profile";
import { dateBR, dateTimeBR, money, pct } from "@/lib/format";
import { requireProfile } from "@/lib/session";
import { withUser } from "@/server/db";
import { getAlert } from "@/server/services/monitoring";

export const dynamic = "force-dynamic";

const RULE_LABEL: Record<string, string> = {
  price_move: "Variação de preço", stablecoin_depeg: "Perda de paridade", volatility: "Mudança de volatilidade", risk_change: "Mudança de risco", concentration: "Concentração",
  drift: "Desvio da alocação-alvo", rates_br: "Juros (Brasil)", rates_us: "Juros (EUA)", fx: "Câmbio", profile_mismatch: "Risco vs. perfil", drawdown: "Queda desde o pico",
  crypto_cap: "Limite de cripto", data_quality: "Disponibilidade de dados", event_credit: "Evento de crédito", event_regulatory: "Evento regulatório", event_liquidity: "Evento de liquidez",
  event_counterparty: "Evento de contraparte", event_fundamentals: "Fundamentos", event_crypto: "Evento cripto",
};

export default async function AlertDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, profile } = await requireProfile();
  const a = await withUser(user.id, (tx) => getAlert(tx, id));
  if (!a) notFound();
  const base = profile.answers.baseCurrency;
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/alerts" className="hover:underline">← Central de alertas</Link>}
        title={a.title}
        actions={
          <>
            {a.status !== "acknowledged" && <ActionButton variant="outline" action={setAlertStatusAction.bind(null, a.id, "acknowledged")}>Reconhecer</ActionButton>}
            {a.status !== "resolved" && <ActionButton variant="outline" action={setAlertStatusAction.bind(null, a.id, "resolved")}>Marcar como resolvido</ActionButton>}
            {a.status !== "open" && <ActionButton variant="ghost" action={setAlertStatusAction.bind(null, a.id, "open")}>Reabrir</ActionButton>}
          </>
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <SeverityBadge severity={a.severity} />
        <Badge variant="secondary">{RULE_LABEL[a.rule] ?? a.rule}</Badge>
        <Badge variant="outline">{a.status === "open" ? "Em aberto" : a.status === "acknowledged" ? "Reconhecido" : "Resolvido"}</Badge>
        {a.uses_demo_data && <DemoBadge label="baseado em dados demo" />}
        <span className="text-xs text-muted-foreground">Análise em {dateTimeBR(a.analyzed_at)} · detectado {a.occurrences}× · última ocorrência {dateTimeBR(a.last_seen_at)}</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="space-y-5 p-6">
            <section><h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">O que mudou</h3><p className="mt-1">{a.what_changed}</p></section>
            <section><h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Por que isso importa</h3><p className="mt-1">{a.why_matters}</p></section>
            <section><h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Impacto potencial no portfólio</h3>
              <p className="mt-1">{a.impact.description}</p>
              {a.impact.portfolioPct != null && <p className="mt-1 text-sm tabular">{pct(a.impact.portfolioPct, 2, true)}{a.impact.amount != null && ` · ${money(a.impact.amount, base)}`}</p>}
            </section>
            <section className="rounded-xl bg-muted p-4"><h3 className="text-sm font-semibold">Ação sugerida</h3><p className="mt-1 text-sm">{a.suggested_action}</p><p className="mt-2 text-[11px] text-muted-foreground">Sugestão analítica; o Atlas não executa ordens.</p></section>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Afetados</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div><div className="text-xs text-muted-foreground">Portfólio</div>{a.portfolio_id ? <Link href={`/portfolios/${a.portfolio_id}`} className="underline">{a.portfolio_name}</Link> : "—"}</div>
            <div><div className="text-xs text-muted-foreground">Ativos</div>{a.affected.assets.length ? a.affected.assets.map((x) => <Link key={x} href={`/assets/${x}`} className="mr-2 underline">{CATALOG_BY_ID.get(x)?.symbol ?? x}</Link>) : "Carteira como um todo"}</div>
            <div><div className="text-xs text-muted-foreground">Objetivos</div>{a.affected.objectives.map((o) => OBJECTIVE_LABEL[o as keyof typeof OBJECTIVE_LABEL] ?? o).join(", ") || "—"}</div>
            <div><div className="text-xs text-muted-foreground">Urgência</div>{a.severity === "critical" ? "Alta — revisar hoje" : a.severity === "attention" ? "Média — revisar nos próximos dias" : "Baixa — informativo"}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader><CardTitle>Evidências e fontes</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-2">Dado</th><th className="pb-2">Valor</th><th className="pb-2">Fonte</th><th className="pb-2">Data</th><th /></tr></thead>
            <tbody>{a.evidence.map((e, i) => (
              <tr key={i} className="border-t"><td className="py-2">{e.label}</td><td className="tabular">{e.value}</td><td>{e.source}</td><td>{e.asOf ? (e.asOf.length > 10 ? dateTimeBR(e.asOf) : dateBR(e.asOf)) : "—"}</td><td>{e.isDemo && <DemoBadge />}</td></tr>
            ))}</tbody>
          </table>
          <p className="mt-3 text-[11px] text-muted-foreground">Regra avaliada por função determinística (alerts-v1.0) com limites configuráveis em Configurações › Limites de alerta.</p>
        </CardContent>
      </Card>
    </>
  );
}
