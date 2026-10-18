import Link from "next/link";
import { BellOff } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { DemoBadge, SeverityBadge } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { markNotificationsReadAction, runMonitoringAction } from "@/app/actions";
import type { Severity } from "@/domain/types";
import { dateTimeBR, money, pct } from "@/lib/format";
import { requireProfile } from "@/lib/session";
import { cn } from "@/lib/utils";
import { withUser } from "@/server/db";
import { listAlerts, listRuns } from "@/server/services/monitoring";
import { listNotifications } from "@/server/services/notifications";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "alerts", label: "Alertas" },
  { key: "notifications", label: "Notificações" },
  { key: "runs", label: "Execuções do monitor" },
];

const CHANNEL: Record<string, string> = { in_app: "No app", email: "E-mail", webhook: "Webhook" };
const STATUS: Record<string, string> = { delivered: "Entregue", queued: "Na fila", not_configured: "Canal não configurado", failed: "Falhou", skipped: "Ignorado" };

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ tab?: string; severity?: string; status?: string }> }) {
  const { user, profile } = await requireProfile();
  const sp = await searchParams;
  const tab = sp.tab ?? "alerts";
  const severity = (["info", "attention", "critical"].includes(sp.severity ?? "") ? sp.severity : undefined) as Severity | undefined;
  const status = ["open", "acknowledged", "resolved"].includes(sp.status ?? "") ? sp.status : undefined;
  const data = await withUser(user.id, async (tx) => ({
    alerts: tab === "alerts" ? await listAlerts(tx, { severity, status }) : [],
    notifications: tab === "notifications" ? await listNotifications(tx, 100) : [],
    runs: await listRuns(tx, tab === "runs" ? 50 : 1),
  }));
  const q = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { tab, severity, status, ...o };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/alerts?${p.toString()}`;
  };
  const base = profile.answers.baseCurrency;

  return (
    <>
      <PageHeader
        eyebrow="Daily Portfolio Monitor"
        title="Central de alertas"
        description={<>Monitoramento diário automático após o fechamento dos mercados e sob demanda. Alertas repetidos dentro da janela de silêncio são agrupados. Último monitoramento: {dateTimeBR(data.runs[0]?.started_at)}.</>}
        actions={<><ActionButton variant="outline" action={markNotificationsReadAction}>Marcar notificações como lidas</ActionButton><ActionButton variant="brand" action={runMonitoringAction} pendingLabel="Monitorando…">Executar monitoramento agora</ActionButton></>}
      />
      <div className="mb-5 flex gap-1 border-b">
        {TABS.map((t) => <Link key={t.key} href={`/alerts?tab=${t.key}`} className={cn("-mb-px border-b-2 px-4 py-2 text-sm", tab === t.key ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>{t.label}</Link>)}
      </div>

      {tab === "alerts" && (
        <>
          <div className="mb-4 flex flex-wrap gap-2 text-xs">
            {[undefined, "critical", "attention", "info"].map((s) => <Link key={s ?? "all"} href={q({ severity: s ?? "" })} className={cn("rounded-full border px-3 py-1", severity === s ? "bg-primary text-primary-foreground" : "bg-card")}>{s ? { critical: "Crítico", attention: "Atenção", info: "Informativo" }[s] : "Todas as severidades"}</Link>)}
            <span className="mx-1 border-l" />
            {[undefined, "open", "acknowledged", "resolved"].map((s) => <Link key={s ?? "all"} href={q({ status: s ?? "" })} className={cn("rounded-full border px-3 py-1", status === s ? "bg-primary text-primary-foreground" : "bg-card")}>{s ? { open: "Em aberto", acknowledged: "Reconhecidos", resolved: "Resolvidos" }[s] : "Todos os status"}</Link>)}
          </div>
          {data.alerts.length === 0 ? (
            <EmptyState icon={<BellOff className="h-8 w-8" />} title="Nenhum alerta" description="Sem alertas para os filtros escolhidos. Para testar, aplique um cenário no Laboratório de demonstração (Configurações) e execute o monitoramento." action={<Link className="text-sm underline" href="/settings#demo">Abrir laboratório de demonstração</Link>} />
          ) : (
            <div className="space-y-3">
              {data.alerts.map((a) => (
                <Link key={a.id} href={`/alerts/${a.id}`} className={cn("block rounded-2xl border bg-card p-4 transition hover:border-foreground/30", a.severity === "critical" && "border-l-4 border-l-critical", a.severity === "attention" && "border-l-4 border-l-attention", a.severity === "info" && "border-l-4 border-l-info", a.status !== "open" && "opacity-70")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={a.severity} />
                    <span className="font-semibold">{a.title}</span>
                    {a.uses_demo_data && <DemoBadge />}
                    {a.status !== "open" && <Badge variant="outline">{a.status === "acknowledged" ? "Reconhecido" : "Resolvido"}</Badge>}
                    {a.occurrences > 1 && <Badge variant="secondary">{a.occurrences}× detectado</Badge>}
                    <span className="ml-auto text-xs text-muted-foreground">{a.portfolio_name} · {dateTimeBR(a.analyzed_at)}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground">{a.what_changed}</p>
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                    {a.impact.portfolioPct != null && <span>Impacto: <b className="tabular">{pct(a.impact.portfolioPct, 2, true)}</b>{a.impact.amount != null && ` (${money(a.impact.amount, base)})`}</span>}
                    <span>Ação sugerida: {a.suggested_action}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "notifications" && (
        <Card>
          <CardHeader><CardTitle>Notificações</CardTitle><CardDescription>Entregas por canal. E-mail e webhook são configurados em Configurações › Notificações.</CardDescription></CardHeader>
          <CardContent>
            {data.notifications.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma notificação.</p> : (
              <ul className="divide-y">{data.notifications.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  {!n.read_at && n.channel === "in_app" && <span className="h-2 w-2 rounded-full bg-brand" title="Não lida" />}
                  {n.severity && <SeverityBadge severity={n.severity} />}
                  {n.alert_id ? <Link href={`/alerts/${n.alert_id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">{n.title}</Link> : <span className="flex-1 text-sm">{n.title}</span>}
                  <Badge variant="outline">{CHANNEL[n.channel] ?? n.channel}</Badge>
                  <Badge variant={n.status === "delivered" ? "brand" : n.status === "failed" ? "critical" : "secondary"} title={n.detail ?? undefined}>{STATUS[n.status] ?? n.status}</Badge>
                  <span className="text-xs text-muted-foreground">{dateTimeBR(n.created_at)}</span>
                </li>
              ))}</ul>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "runs" && (
        <div className="space-y-3">
          {data.runs.map((r) => {
            const ms = r.market_status as { markets?: { market: string; tradingDay: boolean; holidayCalendar: boolean }[]; dataStatus?: Record<string, number>; sources?: { id: string; name: string; configured: boolean; status: string; lastError: string | null }[]; usesDemoData?: boolean };
            return (
              <Card key={r.id}>
                <CardContent className="p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={r.status === "ok" ? "brand" : r.status === "partial" ? "attention" : "critical"}>{r.status === "ok" ? "OK" : r.status === "partial" ? "Parcial" : r.status}</Badge>
                    <span className="font-medium">{dateTimeBR(r.started_at)}</span>
                    <Badge variant="outline">{r.trigger === "scheduled" ? "Agendado" : r.trigger === "manual" ? "Manual" : "API"}</Badge>
                    {ms.usesDemoData && <DemoBadge />}
                    <span className="ml-auto text-xs text-muted-foreground">{r.alerts_created} alerta(s) · {r.alerts_suppressed} suprimido(s) · regras {r.rules_version}</span>
                  </div>
                  <div className="mt-3 grid gap-4 break-words md:grid-cols-3 [&>*]:min-w-0">
                    <div><div className="text-xs font-medium text-muted-foreground">Mercados</div>
                      {ms.markets?.map((m) => <div key={m.market} className="text-xs">{m.market === "GLOBAL" ? "Cripto (24/7)" : m.market}: {m.tradingDay ? "dia de negociação" : "sem negociação (fim de semana/feriado)"}{!m.holidayCalendar && " · calendário de feriados não coberto"}</div>)}</div>
                    <div><div className="text-xs font-medium text-muted-foreground">Status dos dados (posições)</div>
                      {Object.entries(ms.dataStatus ?? {}).map(([k, v]) => <div key={k} className="text-xs">{k}: {v}</div>)}</div>
                    <div><div className="text-xs font-medium text-muted-foreground">Fontes reais</div>
                      {ms.sources?.map((s) => <div key={s.id} className="truncate text-xs" title={s.lastError ?? undefined}>{s.name}: {!s.configured ? "não configurada" : s.status === "ok" ? "ok" : s.status === "error" ? "indisponível" : s.status}</div>)}</div>
                  </div>
                  {r.summary.portfolios && <div className="mt-3 text-xs text-muted-foreground">{r.summary.portfolios.map((p) => `${p.name}: ${p.skipped ?? `${money(p.value, base)}, risco ${p.risk}/10, ${p.alerts} alerta(s)`}`).join(" · ")}</div>}
                </CardContent>
              </Card>
            );
          })}
          {data.runs.length === 0 && <EmptyState title="Nenhuma execução" description="Execute o monitoramento para registrar a primeira verificação." />}
        </div>
      )}
    </>
  );
}
