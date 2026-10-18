"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import type { Thresholds } from "@/domain/alerts";
import type { NotificationPrefs } from "@/server/services/profile";
import { applyScenarioAction, deleteAccountAction, savePreferencesAction } from "@/app/actions";

const SEV = [{ v: "info", l: "Informativo ou acima" }, { v: "attention", l: "Atenção ou acima" }, { v: "critical", l: "Somente crítico" }] as const;

const THRESHOLD_FIELDS: { key: keyof Thresholds; label: string; unit: "%" | "pp" | "x" | "h" }[] = [
  { key: "priceMoveEquity", label: "Variação de preço — ações, ETFs, FIIs/REITs", unit: "%" },
  { key: "priceMoveCrypto", label: "Variação de preço — cripto", unit: "%" },
  { key: "priceMoveFixed", label: "Variação de preço — renda fixa/fundos", unit: "%" },
  { key: "stablecoinDepeg", label: "Desvio de paridade de stablecoin", unit: "%" },
  { key: "driftPp", label: "Desvio da alocação-alvo", unit: "pp" },
  { key: "maxSingleWeight", label: "Peso máximo por ativo", unit: "%" },
  { key: "fxMove", label: "Variação cambial USD/BRL", unit: "%" },
  { key: "rateMovePp", label: "Mudança de juros (CDI / T-Bill)", unit: "pp" },
  { key: "volRatio", label: "Volatilidade recente / média 1 ano", unit: "x" },
  { key: "minWeightForPriceAlert", label: "Peso mínimo para alertar variação", unit: "%" },
  { key: "cooldownHours", label: "Janela de silêncio para alertas repetidos", unit: "h" },
];

const toDisplay = (v: number, unit: string) => (unit === "%" || unit === "pp" ? String(Math.round(v * 10000) / 100) : String(v));
const fromDisplay = (s: string, unit: string) => { const n = Number(s.replace(",", ".")); return unit === "%" || unit === "pp" ? n / 100 : n; };

export function PreferencesForm({ notifications, thresholds, emailConfigured }: { notifications: NotificationPrefs; thresholds: Thresholds; emailConfigured: boolean }) {
  const [n, setN] = useState(notifications);
  const [t, setT] = useState(Object.fromEntries(THRESHOLD_FIELDS.map((f) => [f.key, toDisplay(thresholds[f.key] as number, f.unit)])) as Record<string, string>);
  const [minSeverity, setMinSeverity] = useState(thresholds.minSeverity);
  const [pending, start] = useTransition();
  const router = useRouter();
  const save = () => start(async () => {
    const th = { ...Object.fromEntries(THRESHOLD_FIELDS.map((f) => [f.key, fromDisplay(t[f.key], f.unit)])), minSeverity } as Thresholds;
    const r = await savePreferencesAction({ notifications: n, thresholds: th });
    if (r.ok) { toast.success("Preferências salvas."); router.refresh(); } else toast.error(r.error);
  });
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Notificações</CardTitle><CardDescription>A central no app está sempre disponível. E-mail e webhook (Slack, Teams, Telegram via bridge) estão preparados para configuração.</CardDescription></CardHeader>
        <CardContent className="space-y-5 text-sm">
          <label className="flex items-center justify-between gap-3"><span>Central de notificações no app</span><Switch checked={n.inApp} onCheckedChange={(v) => setN({ ...n, inApp: v })} /></label>
          <div className="space-y-2 rounded-lg border p-3">
            <label className="flex items-center justify-between gap-3"><span>E-mail {!emailConfigured && <span className="text-xs text-attention">(servidor de e-mail não configurado — mensagens ficam na fila)</span>}</span><Switch checked={n.email.enabled} onCheckedChange={(v) => setN({ ...n, email: { ...n.email, enabled: v } })} /></label>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="seu@email.com" value={n.email.address} onChange={(e) => setN({ ...n, email: { ...n.email, address: e.target.value } })} />
              <NativeSelect value={n.email.minSeverity} onChange={(e) => setN({ ...n, email: { ...n.email, minSeverity: e.target.value as "info" } })}>{SEV.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</NativeSelect>
            </div>
          </div>
          <div className="space-y-2 rounded-lg border p-3">
            <label className="flex items-center justify-between gap-3"><span>Webhook (HTTPS, JSON)</span><Switch checked={n.webhook.enabled} onCheckedChange={(v) => setN({ ...n, webhook: { ...n.webhook, enabled: v } })} /></label>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="https://hooks.exemplo.com/…" value={n.webhook.url} onChange={(e) => setN({ ...n, webhook: { ...n.webhook, url: e.target.value } })} />
              <NativeSelect value={n.webhook.minSeverity} onChange={(e) => setN({ ...n, webhook: { ...n.webhook, minSeverity: e.target.value as "info" } })}>{SEV.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</NativeSelect>
            </div>
          </div>
          <div className="space-y-1.5"><Label>Gerar alertas a partir de</Label>
            <NativeSelect value={minSeverity} onChange={(e) => setMinSeverity(e.target.value as Thresholds["minSeverity"])}>{SEV.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</NativeSelect>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Limites de alerta</CardTitle><CardDescription>Evitam alertas por oscilações irrelevantes. Valores em % ou pontos percentuais.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {THRESHOLD_FIELDS.map((f) => (
            <div key={f.key} className="grid grid-cols-[1fr_96px_28px] items-center gap-2 text-sm">
              <span className="text-muted-foreground">{f.label}</span>
              <Input className="h-8 text-right" value={t[f.key]} onChange={(e) => setT({ ...t, [f.key]: e.target.value })} />
              <span className="text-xs text-muted-foreground">{f.unit === "pp" ? "p.p." : f.unit}</span>
            </div>
          ))}
          <div className="pt-3"><Button disabled={pending} onClick={save}>{pending ? "Salvando…" : "Salvar preferências e limites"}</Button></div>
        </CardContent>
      </Card>
    </div>
  );
}

export function ScenarioButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button size="sm" variant="outline" className="mt-3 self-start" disabled={pending} onClick={() => start(async () => {
      const r = await applyScenarioAction(id);
      if (r.ok) { toast.success(r.message ?? "Cenário aplicado."); router.refresh(); } else toast.error(r.error);
    })}>{pending ? "Aplicando…" : "Aplicar cenário"}</Button>
  );
}

export function DeleteAccount({ disabled }: { disabled: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="destructive" disabled={disabled || pending} title={disabled ? "A conta demo não pode ser excluída" : undefined} onClick={() => {
      const c = window.prompt("Isto apaga permanentemente sua conta, perfil, portfólios, alertas e recomendações. Digite EXCLUIR para confirmar.");
      if (c == null) return;
      start(async () => { const r = await deleteAccountAction(c); if (r && !r.ok) toast.error(r.error); });
    }}>Excluir minha conta</Button>
  );
}
