"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { GitCompareArrows, Info, SlidersHorizontal, X } from "lucide-react";
import { CompatibilityBadge, DemoBadge, OriginBadge, RiskBadge } from "@/components/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ASSET_CLASS_SHORT, ALL_ASSET_CLASSES, type AssetClass, type RiskCategory } from "@/domain/types";
import { dateBR, pct } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface DiscoverRow {
  id: string; symbol: string; name: string; assetClass: AssetClass; market: string; currency: string;
  base: number | null; pessimistic: number | null; optimistic: number | null; afterTax: number | null; probLoss: number | null;
  volatility: number | null; volatilitySource: string; maxDrawdown: number | null; return1y: number | null;
  risk: number; riskCategory: RiskCategory; credit: number | null; counterparty: number | null; technology: number | null; liquidityScore: number | null;
  componentSummary: { label: string; score: number | null }[];
  liquidityDays: number | null; locked: boolean; maturity: string | null; minHorizon: number | null; fees: number; taxNote: string;
  dataQuality: number; dataQualityLabel: string; origin: "real" | "demo" | null; source: string | null; status: string; lastDate: string | null;
  eligible: boolean; eligibilityIssues: string[]; compatibility: "alta" | "média" | "baixa" | "incompatível"; compatibilityScore: number;
  reasons: string[]; warnings: string[]; rationale: string; meetsTarget: boolean; fxAdjusted: boolean; insufficient: string[];
}

interface Filters {
  classes: AssetClass[]; market: string; currency: string; minReturn: string; maxRisk: string; maxVol: string; maxDD: string; maxProbLoss: string;
  maxLiquidityDays: string; horizonOk: boolean; maxFees: string; minQuality: string; maxCredit: string; maxCounterparty: string; maxTech: string; onlyEligible: boolean; onlyCompatible: boolean;
}

const EMPTY: Filters = { classes: [], market: "any", currency: "any", minReturn: "", maxRisk: "", maxVol: "", maxDD: "", maxProbLoss: "", maxLiquidityDays: "", horizonOk: false, maxFees: "", minQuality: "", maxCredit: "", maxCounterparty: "", maxTech: "", onlyEligible: true, onlyCompatible: false };

type SortKey = "compat" | "return" | "risk" | "liquidity" | "quality";

const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

export function DiscoverClient({ rows, target, maxRisk, base, macroAsOf, macroDemo }: { rows: DiscoverRow[]; target: number; maxRisk: number; base: string; macroAsOf: string; macroDemo: boolean }) {
  const [f, setF] = useState<Filters>(EMPTY);
  const [sort, setSort] = useState<SortKey>("compat");
  const [showFilters, setShowFilters] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((s) => ({ ...s, [k]: v }));

  const filtered = useMemo(() => {
    const out = rows.filter((r) => {
      if (f.onlyEligible && !r.eligible) return false;
      if (f.onlyCompatible && (r.compatibility === "incompatível" || r.compatibility === "baixa")) return false;
      if (f.classes.length && !f.classes.includes(r.assetClass)) return false;
      if (f.market !== "any" && r.market !== f.market) return false;
      if (f.currency !== "any" && r.currency !== f.currency) return false;
      const minR = n(f.minReturn); if (minR != null && (r.base == null || r.base * 100 < minR)) return false;
      const mR = n(f.maxRisk); if (mR != null && r.risk > mR) return false;
      const mV = n(f.maxVol); if (mV != null && (r.volatility == null || r.volatility * 100 > mV)) return false;
      const mD = n(f.maxDD); if (mD != null && r.maxDrawdown != null && r.maxDrawdown * 100 > mD) return false;
      const mP = n(f.maxProbLoss); if (mP != null && (r.probLoss == null || r.probLoss * 100 > mP)) return false;
      const mL = n(f.maxLiquidityDays); if (mL != null && (r.locked || (r.liquidityDays ?? 999) > mL)) return false;
      if (f.horizonOk && r.warnings.some((w) => w.startsWith("Horizonte recomendado"))) return false;
      const mF = n(f.maxFees); if (mF != null && r.fees * 100 > mF) return false;
      const mQ = n(f.minQuality); if (mQ != null && r.dataQuality < mQ) return false;
      const mC = n(f.maxCredit); if (mC != null && (r.credit ?? 0) > mC) return false;
      const mCp = n(f.maxCounterparty); if (mCp != null && (r.counterparty ?? 0) > mCp) return false;
      const mT = n(f.maxTech); if (mT != null && (r.technology ?? 0) > mT) return false;
      return true;
    });
    const by: Record<SortKey, (a: DiscoverRow, b: DiscoverRow) => number> = {
      compat: (a, b) => b.compatibilityScore - a.compatibilityScore,
      return: (a, b) => (b.base ?? -1) - (a.base ?? -1),
      risk: (a, b) => a.risk - b.risk,
      liquidity: (a, b) => (a.locked ? 9999 : a.liquidityDays ?? 999) - (b.locked ? 9999 : b.liquidityDays ?? 999),
      quality: (a, b) => b.dataQuality - a.dataQuality,
    };
    return out.sort(by[sort]);
  }, [rows, f, sort]);

  const toggleCompare = (id: string) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 4 ? c : [...c, id]));
  const compared = rows.filter((r) => compare.includes(r.id));
  const activeCount = Object.entries(f).filter(([k, v]) => k !== "onlyEligible" && (Array.isArray(v) ? v.length : typeof v === "boolean" ? v : v !== "" && v !== "any")).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => setShowFilters((s) => !s)}><SlidersHorizontal /> Filtros {activeCount > 0 && <Badge variant="brand">{activeCount}</Badge>}</Button>
        <div className="flex flex-wrap gap-1.5">
          {ALL_ASSET_CLASSES.map((c) => (
            <button key={c} onClick={() => set("classes", f.classes.includes(c) ? f.classes.filter((x) => x !== c) : [...f.classes, c])}
              className={cn("rounded-full border px-2.5 py-1 text-xs", f.classes.includes(c) ? "border-foreground bg-primary text-primary-foreground" : "bg-card hover:border-foreground/30")}>{ASSET_CLASS_SHORT[c]}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Ordenar</span>
          <NativeSelect value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="w-44">
            <option value="compat">Compatibilidade</option><option value="return">Retorno esperado</option><option value="risk">Menor risco</option><option value="liquidity">Maior liquidez</option><option value="quality">Qualidade dos dados</option>
          </NativeSelect>
        </div>
      </div>

      {showFilters && (
        <Card>
          <CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1"><Label>Mercado</Label><NativeSelect value={f.market} onChange={(e) => set("market", e.target.value)}><option value="any">Todos</option><option value="BR">Brasil</option><option value="US">EUA</option><option value="GLOBAL">Global (cripto/RWA)</option></NativeSelect></div>
            <div className="space-y-1"><Label>Moeda / exposição cambial</Label><NativeSelect value={f.currency} onChange={(e) => set("currency", e.target.value)}><option value="any">Todas</option><option value="BRL">BRL</option><option value="USD">USD</option></NativeSelect></div>
            <div className="space-y-1"><Label>Retorno esperado mín. (% a.a.)</Label><Input value={f.minReturn} onChange={(e) => set("minReturn", e.target.value)} placeholder={`ex. ${(target * 100).toFixed(0)}`} /></div>
            <div className="space-y-1"><Label>Nota de risco máx. (1–10)</Label><Input value={f.maxRisk} onChange={(e) => set("maxRisk", e.target.value)} placeholder={String(maxRisk)} /></div>
            <div className="space-y-1"><Label>Volatilidade máx. (% a.a.)</Label><Input value={f.maxVol} onChange={(e) => set("maxVol", e.target.value)} /></div>
            <div className="space-y-1"><Label>Drawdown histórico máx. (%)</Label><Input value={f.maxDD} onChange={(e) => set("maxDD", e.target.value)} /></div>
            <div className="space-y-1"><Label>Prob. de perda máx. (%)</Label><Input value={f.maxProbLoss} onChange={(e) => set("maxProbLoss", e.target.value)} /></div>
            <div className="space-y-1"><Label>Prazo de resgate máx. (dias úteis)</Label><Input value={f.maxLiquidityDays} onChange={(e) => set("maxLiquidityDays", e.target.value)} /></div>
            <div className="space-y-1"><Label>Custos máx. (% a.a.)</Label><Input value={f.maxFees} onChange={(e) => set("maxFees", e.target.value)} /></div>
            <div className="space-y-1"><Label>Qualidade de dados mín. (0–100)</Label><Input value={f.minQuality} onChange={(e) => set("minQuality", e.target.value)} /></div>
            <div className="space-y-1"><Label>Risco de crédito máx.</Label><Input value={f.maxCredit} onChange={(e) => set("maxCredit", e.target.value)} /></div>
            <div className="space-y-1"><Label>Risco de contraparte/plataforma máx.</Label><Input value={f.maxCounterparty} onChange={(e) => set("maxCounterparty", e.target.value)} /></div>
            <div className="space-y-1"><Label>Risco smart contract/custódia máx.</Label><Input value={f.maxTech} onChange={(e) => set("maxTech", e.target.value)} /></div>
            <div className="flex flex-col justify-end gap-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.onlyEligible} onChange={(e) => set("onlyEligible", e.target.checked)} /> Somente elegíveis para mim</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.onlyCompatible} onChange={(e) => set("onlyCompatible", e.target.checked)} /> Somente compatibilidade média/alta</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.horizonOk} onChange={(e) => set("horizonOk", e.target.checked)} /> Compatível com meu horizonte</label>
            </div>
            <div className="sm:col-span-2 lg:col-span-4"><Button variant="ghost" size="sm" onClick={() => setF(EMPTY)}>Limpar filtros</Button></div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{filtered.length} de {rows.length} ativos · indicadores macro de {dateBR(macroAsOf)} {macroDemo && <DemoBadge className="ml-1" />}</span>
        <span className="flex items-center gap-1"><Info className="h-3.5 w-3.5" /> Selecione até 4 ativos para comparar lado a lado.</span>
      </div>

      {compared.length >= 2 && <ComparePanel rows={compared} onRemove={toggleCompare} base={base} />}

      <div className="grid gap-3">
        {filtered.map((r) => (
          <div key={r.id} className={cn("rounded-2xl border bg-card p-4 sm:p-5", !r.eligible && "opacity-70")}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/assets/${r.id}`} className="font-semibold hover:underline">{r.name}</Link>
                  <Badge variant="secondary">{ASSET_CLASS_SHORT[r.assetClass]}</Badge>
                  <Badge variant="outline">{r.market} · {r.currency}</Badge>
                  <OriginBadge origin={r.origin} />
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">{r.rationale}</p>
                {r.eligibilityIssues.length > 0 && <p className="mt-1 text-xs text-critical">Elegibilidade: {r.eligibilityIssues.join(" ")}</p>}
              </div>
              <div className="grid shrink-0 grid-cols-3 gap-x-5 gap-y-2 text-sm sm:grid-cols-5 lg:w-[560px]">
                <Metric label="Base (a.a.)" value={pct(r.base)} hint={r.base != null && r.base >= target ? "≥ meta" : "< meta"} good={r.base != null && r.base >= target} />
                <Metric label="Faixa" value={r.pessimistic == null ? "—" : `${pct(r.pessimistic, 0)} a ${pct(r.optimistic, 0)}`} />
                <Metric label="Prob. perda" value={r.probLoss == null ? "dados insuf." : pct(r.probLoss)} />
                <Metric label="Liquidez" value={r.locked ? "No venc." : `D+${r.liquidityDays}`} />
                <div><div className="text-[11px] text-muted-foreground">Risco</div><RiskBadge score={r.risk} compact /></div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
              <CompatibilityBadge value={r.compatibility} />
              <span className="text-xs text-muted-foreground">Qualidade dos dados: {r.dataQualityLabel} ({r.dataQuality}) · {r.source ?? "sem fonte"} · {dateBR(r.lastDate)}</span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant={compare.includes(r.id) ? "default" : "outline"} onClick={() => toggleCompare(r.id)}><GitCompareArrows /> {compare.includes(r.id) ? "Comparando" : "Comparar"}</Button>
                <Button size="sm" variant="ghost" asChild><Link href={`/assets/${r.id}`}>Detalhes</Link></Button>
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">Nenhum ativo atende aos filtros. Relaxe algum critério.</p>}
      </div>
    </div>
  );
}

function Metric({ label, value, hint, good }: { label: string; value: string; hint?: string; good?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-medium tabular">{value}</div>
      {hint && <div className={cn("text-[11px]", good ? "text-positive" : "text-muted-foreground")}>{hint}</div>}
    </div>
  );
}

function ComparePanel({ rows, onRemove, base }: { rows: DiscoverRow[]; onRemove: (id: string) => void; base: string }) {
  const classes = new Set(rows.map((r) => r.assetClass));
  const lines: [string, (r: DiscoverRow) => React.ReactNode][] = [
    ["Classe / mercado", (r) => `${ASSET_CLASS_SHORT[r.assetClass]} · ${r.market}`],
    [`Cenário-base (a.a., ${base})`, (r) => pct(r.base)],
    ["Pessimista / otimista", (r) => (r.pessimistic == null ? "—" : `${pct(r.pessimistic)} / ${pct(r.optimistic)}`)],
    ["Após IR (estim.)", (r) => (r.afterTax == null ? "depende da residência" : pct(r.afterTax))],
    ["Prob. de perda no horizonte", (r) => (r.probLoss == null ? "dados insuficientes" : pct(r.probLoss))],
    ["Volatilidade", (r) => (r.volatility == null ? "dados insuficientes" : `${pct(r.volatility)} (${r.volatilitySource})`)],
    ["Drawdown histórico", (r) => (r.maxDrawdown == null ? "n/a" : pct(-r.maxDrawdown))],
    ["Nota de risco", (r) => <RiskBadge score={r.risk} category={r.riskCategory} />],
    ...(["Mercado", "Crédito", "Liquidez", "Cambial", "Contraparte", "Regulatório", "Tecnológico / smart contract"] as const).map((lbl) => [lbl, (r: DiscoverRow) => { const s = r.componentSummary.find((c) => c.label === lbl)?.score; return s == null ? "n/a" : `${s}/10`; }] as [string, (r: DiscoverRow) => React.ReactNode]),
    ["Liquidez / prazo", (r) => (r.locked ? `No vencimento (${r.maturity ?? "—"})` : `D+${r.liquidityDays}`)],
    ["Custos anuais", (r) => pct(r.fees, 2)],
    ["Compatibilidade", (r) => <CompatibilityBadge value={r.compatibility} />],
    ["Dados", (r) => <span className="inline-flex items-center gap-1"><OriginBadge origin={r.origin} /> {r.dataQualityLabel}</span>],
  ];
  return (
    <Card className="border-foreground/20">
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2"><GitCompareArrows className="h-4 w-4" /> Comparação lado a lado</CardTitle>
        {classes.size > 1 && <p className="text-xs text-attention">Atenção: você está comparando classes diferentes. Volatilidade de renda fixa (marcação a mercado), ações e cripto não medem o mesmo risco — compare também crédito, liquidez e risco tecnológico, e lembre que renda fixa mantida até o vencimento não sofre a oscilação exibida.</p>}
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr><th className="w-48" />{rows.map((r) => <th key={r.id} className="px-3 pb-2 text-left align-bottom"><div className="flex items-start justify-between gap-2"><Link href={`/assets/${r.id}`} className="font-semibold hover:underline">{r.symbol}</Link><button onClick={() => onRemove(r.id)} aria-label="Remover"><X className="h-3.5 w-3.5 text-muted-foreground" /></button></div></th>)}</tr></thead>
          <tbody>
            {lines.map(([label, fn]) => (
              <tr key={label} className="border-t"><td className="py-2 pr-3 text-muted-foreground">{label}</td>{rows.map((r) => <td key={r.id} className="px-3 py-2 tabular">{fn(r)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
