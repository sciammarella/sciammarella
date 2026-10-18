"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { deriveProfile, EXPERIENCE_LABEL, LIQUIDITY_LABEL, OBJECTIVE_LABEL, TOLERANCE_LABEL } from "@/domain/profile";
import { HORIZON_LABEL } from "@/domain/analytics";
import { ALL_ASSET_CLASSES, ASSET_CLASS_LABEL, type AssetClass, type ProfileAnswers } from "@/domain/types";
import { cn } from "@/lib/utils";
import { saveProfileAction } from "../actions";

function Choice<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; hint?: string }[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <button type="button" key={o.value} onClick={() => onChange(o.value)}
          className={cn("rounded-xl border p-3.5 text-left transition", value === o.value ? "border-brand bg-brand-soft ring-1 ring-brand" : "bg-card hover:border-foreground/30")}>
          <div className="flex items-center justify-between text-sm font-medium">{o.label}{value === o.value && <Check className="h-4 w-4 text-brand" />}</div>
          {o.hint && <div className="mt-0.5 text-xs text-muted-foreground">{o.hint}</div>}
        </button>
      ))}
    </div>
  );
}

const STEPS = ["Residência e valor", "Objetivo e meta", "Risco e liquidez", "Mercados e classes", "Experiência", "Seu perfil"];

export function OnboardingWizard({ initial }: { initial: ProfileAnswers | null }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, start] = useTransition();
  const [a, setA] = useState<ProfileAnswers>(
    initial ?? {
      residenceCountry: "BR", baseCurrency: "BRL", amount: 50000, objective: "growth", targetReturn: 0.12, horizon: "3to5", lossTolerance: "moderate",
      liquidityNeed: "monthly", markets: ["BR", "US"], allowedClasses: [], excludedClasses: [], experience: "basic", cryptoExperience: "none", qualifiedInvestor: false,
    },
  );
  const set = <K extends keyof ProfileAnswers>(k: K, v: ProfileAnswers[K]) => setA((s) => ({ ...s, [k]: v }));
  const derived = useMemo(() => deriveProfile(a), [a]);
  const cur = a.baseCurrency === "BRL" ? "R$" : "US$";
  const lossExample = a.amount * 0.2;

  const toggleExcluded = (c: AssetClass) => set("excludedClasses", a.excludedClasses.includes(c) ? a.excludedClasses.filter((x) => x !== c) : [...a.excludedClasses, c]);
  const toggleMarket = (m: "BR" | "US") => {
    const next = a.markets.includes(m) ? a.markets.filter((x) => x !== m) : [...a.markets, m];
    if (next.length) set("markets", next);
  };

  const save = () =>
    start(async () => {
      const r = await saveProfileAction(a);
      if (r.ok) {
        toast.success("Perfil salvo.");
        router.push(initial ? "/settings" : "/discover");
        router.refresh();
      } else toast.error(r.error);
    });

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>Etapa {step + 1} de {STEPS.length} · {STEPS[step]}</span>
          <span>{Math.round(((step + 1) / STEPS.length) * 100)}%</span>
        </div>
        <Progress value={((step + 1) / STEPS.length) * 100} />
      </div>

      <div className="rounded-2xl border bg-card p-6 sm:p-8">
        {step === 0 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Onde você mora e em que moeda pensa seu patrimônio?</h2>
              <p className="text-sm text-muted-foreground">A residência define quais produtos estão disponíveis e a tributação aplicável.</p>
            </div>
            <div className="space-y-2"><Label>País de residência</Label>
              <Choice value={a.residenceCountry} onChange={(v) => { set("residenceCountry", v); if (v === "US") set("baseCurrency", "USD"); if (v === "BR") set("baseCurrency", "BRL"); }}
                options={[{ value: "BR", label: "Brasil" }, { value: "US", label: "Estados Unidos" }, { value: "OTHER", label: "Outro país", hint: "Disponibilidade de produtos não verificada" }]} />
            </div>
            <div className="space-y-2"><Label>Moeda-base</Label>
              <Choice value={a.baseCurrency} onChange={(v) => set("baseCurrency", v)} options={[{ value: "BRL", label: "Real (BRL)" }, { value: "USD", label: "Dólar (USD)" }]} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">Valor aproximado disponível para investir ({cur})</Label>
              <Input id="amount" type="number" min={100} step="any" value={a.amount} onChange={(e) => set("amount", Math.max(0, Number(e.target.value)))} />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-6">
            <div><h2 className="text-lg font-semibold">Qual é o seu objetivo?</h2><p className="text-sm text-muted-foreground">Usamos a meta para avaliar viabilidade — nunca para aumentar o risco que você aceita.</p></div>
            <Choice value={a.objective} onChange={(v) => set("objective", v)} options={(Object.keys(OBJECTIVE_LABEL) as ProfileAnswers["objective"][]).map((k) => ({ value: k, label: OBJECTIVE_LABEL[k] }))} />
            <div className="space-y-3">
              <Label>Rentabilidade anual desejada: <span className="tabular font-semibold text-foreground">{(a.targetReturn * 100).toFixed(1)}% a.a.</span></Label>
              <input type="range" min={1} max={100} step={0.5} value={Math.min(100, a.targetReturn * 100)} onChange={(e) => set("targetReturn", Number(e.target.value) / 100)} className="w-full accent-[hsl(var(--brand))]" />
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Valor customizado (pode ser acima de 100%):</span>
                <Input type="number" className="w-28" min={1} max={500} step={0.5} value={Number((a.targetReturn * 100).toFixed(1))} onChange={(e) => set("targetReturn", Math.max(0.01, Number(e.target.value) / 100))} />
                <span>%</span>
              </div>
              {a.targetReturn >= 0.3 && (
                <p className="flex gap-2 rounded-lg bg-attention-soft p-3 text-xs text-attention"><Info className="h-4 w-4 shrink-0" />Metas acima de 30% a.a. só são alcançáveis, quando são, com risco muito alto de perdas grandes. O Atlas vai mostrar claramente se a meta não for compatível com seu perfil.</p>
              )}
            </div>
            <div className="space-y-2"><Label>Horizonte de investimento</Label>
              <Choice value={a.horizon} onChange={(v) => set("horizon", v)} options={(Object.keys(HORIZON_LABEL) as ProfileAnswers["horizon"][]).map((k) => ({ value: k, label: HORIZON_LABEL[k] }))} />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div><h2 className="text-lg font-semibold">Quanto você suporta perder?</h2>
              <p className="text-sm text-muted-foreground">Imagine que seus {cur} {a.amount.toLocaleString("pt-BR")} caíssem para {cur} {(a.amount - lossExample).toLocaleString("pt-BR")} (−20%) em poucos meses.</p></div>
            <Choice value={a.lossTolerance} onChange={(v) => set("lossTolerance", v)} options={[
              { value: "low", label: TOLERANCE_LABEL.low, hint: "Eu resgataria tudo; quedas acima de ~5% me tirariam o sono." },
              { value: "moderate", label: TOLERANCE_LABEL.moderate, hint: "Desconfortável, mas aguentaria quedas de até ~15%." },
              { value: "high", label: TOLERANCE_LABEL.high, hint: "Manteria o plano com quedas de até ~30%." },
              { value: "very_high", label: TOLERANCE_LABEL.very_high, hint: "Aceito quedas acima de 40% em busca de mais retorno." },
            ]} />
            <div className="space-y-2"><Label>Necessidade de liquidez</Label>
              <Choice value={a.liquidityNeed} onChange={(v) => set("liquidityNeed", v)} options={(Object.keys(LIQUIDITY_LABEL) as ProfileAnswers["liquidityNeed"][]).map((k) => ({ value: k, label: LIQUIDITY_LABEL[k] }))} />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div><h2 className="text-lg font-semibold">Onde e em que você quer investir?</h2><p className="text-sm text-muted-foreground">Cripto e stablecoins são globais e não dependem desta seleção de mercado.</p></div>
            <div className="space-y-2"><Label>Mercados</Label>
              <div className="flex gap-2">
                {(["BR", "US"] as const).map((m) => (
                  <button type="button" key={m} onClick={() => toggleMarket(m)} className={cn("rounded-full border px-4 py-1.5 text-sm", a.markets.includes(m) ? "border-brand bg-brand-soft text-brand" : "bg-card")}>{m === "BR" ? "Brasil" : "Estados Unidos"}</button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Classes de ativos (clique para excluir)</Label>
              <div className="flex flex-wrap gap-2">
                {ALL_ASSET_CLASSES.map((c) => {
                  const excluded = a.excludedClasses.includes(c);
                  return (
                    <button type="button" key={c} onClick={() => toggleExcluded(c)} className={cn("rounded-full border px-3 py-1.5 text-xs", excluded ? "border-critical/40 bg-critical-soft text-critical line-through" : "border-brand/40 bg-brand-soft text-brand")}>
                      {ASSET_CLASS_LABEL[c]}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={!!a.qualifiedInvestor} onChange={(e) => set("qualifiedInvestor", e.target.checked)} className="mt-1" />
              <span>Sou investidor qualificado/profissional (BR) ou accredited investor (EUA). <span className="text-muted-foreground">Usado apenas para filtrar produtos restritos; não verificamos esta declaração.</span></span>
            </label>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold">Qual é a sua experiência?</h2>
            <div className="space-y-2"><Label>Investimentos em geral</Label>
              <Choice value={a.experience} onChange={(v) => set("experience", v)} options={(Object.keys(EXPERIENCE_LABEL) as ProfileAnswers["experience"][]).map((k) => ({ value: k, label: EXPERIENCE_LABEL[k] }))} />
            </div>
            <div className="space-y-2"><Label>Criptoativos</Label>
              <Choice value={a.cryptoExperience} onChange={(v) => set("cryptoExperience", v)} options={(Object.keys(EXPERIENCE_LABEL) as ProfileAnswers["experience"][]).map((k) => ({ value: k, label: EXPERIENCE_LABEL[k] }))} />
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-5">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Seu perfil de investimento</div>
              <h2 className="mt-1 text-2xl font-semibold">{derived.label}</h2>
            </div>
            <ul className="space-y-2 text-sm">{derived.explanation.map((e) => <li key={e} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" />{e}</li>)}</ul>
            <div className="rounded-xl bg-muted p-4">
              <div className="mb-2 text-sm font-medium">Limites que vamos respeitar</div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{derived.constraints.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
            <p className="text-xs text-muted-foreground">Metodologia {derived.methodologyVersion}. Você pode refazer o perfil a qualquer momento em Configurações.</p>
          </div>
        )}
      </div>

      <div className="mt-5 flex justify-between">
        <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}><ArrowLeft /> Voltar</Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={step === 0 && !(a.amount > 0)}>Continuar <ArrowRight /></Button>
        ) : (
          <Button variant="brand" onClick={save} disabled={pending}>{pending ? "Salvando…" : "Salvar perfil e ver oportunidades"}</Button>
        )}
      </div>
    </div>
  );
}
