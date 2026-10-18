import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { DemoBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { refreshDataAction, runMonitoringAction } from "@/app/actions";
import { DEMO_SCENARIOS } from "@/domain/demo-market";
import { EXPERIENCE_LABEL, LIQUIDITY_LABEL, OBJECTIVE_LABEL, TOLERANCE_LABEL } from "@/domain/profile";
import { HORIZON_LABEL } from "@/domain/analytics";
import { ASSET_CLASS_SHORT } from "@/domain/types";
import { dateTimeBR, money, pct } from "@/lib/format";
import { requireProfile } from "@/lib/session";
import { withUser, driverKind } from "@/server/db";
import { listAudit } from "@/server/services/audit";
import { getMacroSnapshot, listSources } from "@/server/services/market-data";
import { getPreferences } from "@/server/services/profile";
import { pickProvider } from "@/server/ai/providers";
import { DeleteAccount, PreferencesForm, ScenarioButton } from "./client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { user, profile } = await requireProfile();
  const data = await withUser(user.id, async (tx) => ({
    prefs: await getPreferences(tx),
    sources: await listSources(tx),
    audit: await listAudit(tx, 40),
    macro: await getMacroSnapshot(tx),
  }));
  const db = await driverKind();
  const a = profile.answers;
  const d = profile.derived;
  const llm = pickProvider();

  return (
    <>
      <PageHeader eyebrow="Configurações" title="Configurações" description="Perfil, notificações, limites de alerta, fontes de dados, laboratório de demonstração e privacidade." />
      <div className="space-y-5">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div><CardTitle>Perfil de investimento — {d.label}</CardTitle><CardDescription>Atualizado em {dateTimeBR(profile.updatedAt)} · {d.methodologyVersion}</CardDescription></div>
            <Button asChild variant="outline"><Link href="/onboarding">Refazer perfil</Link></Button>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <dl className="grid grid-cols-[170px_1fr] gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Residência / moeda</dt><dd>{a.residenceCountry} · {a.baseCurrency}</dd>
              <dt className="text-muted-foreground">Valor disponível</dt><dd>{money(a.amount, a.baseCurrency)}</dd>
              <dt className="text-muted-foreground">Objetivo</dt><dd>{OBJECTIVE_LABEL[a.objective]}</dd>
              <dt className="text-muted-foreground">Meta</dt><dd>{pct(a.targetReturn)} a.a.</dd>
              <dt className="text-muted-foreground">Horizonte</dt><dd>{HORIZON_LABEL[a.horizon]}</dd>
              <dt className="text-muted-foreground">Tolerância a perdas</dt><dd>{TOLERANCE_LABEL[a.lossTolerance]}</dd>
              <dt className="text-muted-foreground">Liquidez</dt><dd>{LIQUIDITY_LABEL[a.liquidityNeed]}</dd>
              <dt className="text-muted-foreground">Mercados</dt><dd>{a.markets.join(", ")}</dd>
              <dt className="text-muted-foreground">Classes excluídas</dt><dd>{a.excludedClasses.map((c) => ASSET_CLASS_SHORT[c]).join(", ") || "Nenhuma"}</dd>
              <dt className="text-muted-foreground">Experiência / cripto</dt><dd>{EXPERIENCE_LABEL[a.experience]} / {EXPERIENCE_LABEL[a.cryptoExperience]}</dd>
            </dl>
            <div className="space-y-2 text-sm">
              {d.explanation.map((e) => <p key={e}>{e}</p>)}
              <ul className="list-disc pl-5 text-muted-foreground">{d.constraints.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
          </CardContent>
        </Card>

        <PreferencesForm notifications={data.prefs.notifications} thresholds={data.prefs.thresholds} emailConfigured={!!process.env.RESEND_API_KEY} />

        <Card id="fontes">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div><CardTitle>Fontes de dados e integrações</CardTitle><CardDescription>Modo: {process.env.MARKET_DATA_MODE === "demo" ? "somente demonstração" : "tentar fontes reais, com fallback para demo"} · cache de {process.env.MARKET_CACHE_MINUTES ?? 60} min · banco {db === "pglite" ? "PGlite (embutido)" : "PostgreSQL"} · IA {llm ? "Claude" : "não configurada (analista por regras)"}</CardDescription></div>
            <ActionButton variant="outline" action={refreshDataAction} pendingLabel="Atualizando…">Atualizar dados agora</ActionButton>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-2">Fonte</th><th className="pb-2">Tipo</th><th className="pb-2">Configurada</th><th className="pb-2">Status</th><th className="pb-2">Último sucesso</th><th className="pb-2">Observações</th></tr></thead>
              <tbody>
                {data.sources.map((s) => (
                  <tr key={s.id} className="border-t align-top">
                    <td className="py-2 font-medium">{s.name} {s.is_demo && <DemoBadge className="ml-1" />}</td>
                    <td>{s.kind}</td>
                    <td>{s.configured ? "Sim" : "Não"}</td>
                    <td><Badge variant={s.status === "ok" ? "brand" : s.status === "error" ? "critical" : s.status === "partial" ? "attention" : "secondary"}>{s.status === "never" ? "nunca executada" : s.status}</Badge></td>
                    <td className="text-xs">{dateTimeBR(s.last_success_at)}</td>
                    <td className="max-w-md text-xs text-muted-foreground">{s.license_note}{s.last_error && <div className="mt-1 text-critical">Último erro: {s.last_error}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
              {(["CDI", "SELIC", "IPCA12M", "USDBRL", "UST3M", "UST10Y"] as const).map((k) => {
                const v = { CDI: data.macro.cdi, SELIC: data.macro.selic, IPCA12M: data.macro.ipca12m, USDBRL: data.macro.usdbrl, UST3M: data.macro.ust3m, UST10Y: data.macro.ust10y }[k];
                return <div key={k} className="rounded-lg border p-2"><div className="text-muted-foreground">{k}</div><div className="font-semibold tabular">{k === "USDBRL" ? v.toFixed(4) : pct(v, 2)}</div>{data.macro.origin[k] === "demo" ? <DemoBadge /> : <Badge variant="brand">Real</Badge>}</div>;
              })}
            </div>
          </CardContent>
        </Card>

        <Card id="demo" className="border-demo/30">
          <CardHeader><CardTitle className="flex items-center gap-2">Laboratório de demonstração <DemoBadge /></CardTitle><CardDescription>Aplica choques SIMULADOS aos dados de demonstração para testar detecção de mudanças e alertas. Não afeta dados reais. Depois de aplicar, execute o monitoramento.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {DEMO_SCENARIOS.map((s) => (
                <div key={s.id} className="flex flex-col rounded-xl border p-4">
                  <div className="font-medium">{s.label}</div>
                  <p className="mt-1 flex-1 text-xs text-muted-foreground">{s.description}</p>
                  <ScenarioButton id={s.id} />
                </div>
              ))}
            </div>
            <ActionButton variant="brand" action={runMonitoringAction} pendingLabel="Monitorando…">Executar monitoramento agora</ActionButton>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Privacidade e seus dados (LGPD)</CardTitle><CardDescription>Seus dados são isolados por usuário no banco (row-level security). Credenciais de corretoras não são solicitadas nem armazenadas.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild variant="outline"><a href="/api/me/export">Exportar meus dados (JSON)</a></Button>
            <DeleteAccount disabled={user.isDemo} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Histórico de auditoria</CardTitle><CardDescription>Registro somente-inclusão das ações do usuário, do sistema e do agente.</CardDescription></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <tbody>{data.audit.map((e) => (
                <tr key={e.id} className="border-t"><td className="py-1.5 pr-3 text-muted-foreground">{dateTimeBR(e.created_at)}</td><td className="pr-3"><Badge variant="outline">{e.actor}</Badge></td><td className="pr-3 font-medium">{e.action}</td><td className="pr-3">{e.entity}</td><td className="max-w-md truncate font-mono text-muted-foreground">{JSON.stringify(e.details)}</td></tr>
              ))}</tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
