// Server-renderable visual primitives (pure CSS).
import { cn } from "@/lib/utils";
import { pct } from "@/lib/format";
import { riskColorVar } from "./badges";

/** Horizontal scenario range: pessimistic → optimistic with base marker. */
export function ScenarioRange({ pessimistic, base, optimistic, min = -0.4, max = 0.6 }: { pessimistic: number; base: number; optimistic: number; min?: number; max?: number }) {
  const lo = Math.min(min, pessimistic - 0.02);
  const hi = Math.max(max, optimistic + 0.02);
  const pos = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <div>
      <div className="relative h-2.5 rounded-full bg-muted">
        <div className="absolute top-0 h-full w-px bg-foreground/40" style={{ left: pos(0) }} title="0%" />
        <div className="absolute top-0 h-full rounded-full bg-gradient-to-r from-negative/60 via-attention/50 to-positive/60" style={{ left: pos(pessimistic), width: `calc(${pos(optimistic)} - ${pos(pessimistic)})` }} />
        <div className="absolute -top-1 h-4.5 w-1 -translate-x-1/2 rounded bg-foreground" style={{ left: pos(base), height: 18 }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] tabular text-muted-foreground">
        <span>Pessimista {pct(pessimistic)}</span>
        <span className="font-semibold text-foreground">Base {pct(base)}</span>
        <span>Otimista {pct(optimistic)}</span>
      </div>
    </div>
  );
}

export function ScoreBar({ score, label, note }: { score: number | null; label: string; note?: string }) {
  return (
    <div className="grid grid-cols-[140px_1fr_42px] items-center gap-3 text-sm" title={note}>
      <span className="truncate text-muted-foreground">{label}</span>
      <div className="h-2 rounded-full bg-muted">
        {score != null && <div className="h-full rounded-full" style={{ width: `${score * 10}%`, background: `hsl(var(${riskColorVar(score)}))` }} />}
      </div>
      <span className="text-right tabular text-xs">{score == null ? "n/a" : `${score}/10`}</span>
    </div>
  );
}

export function WeightBar({ items, className }: { items: { label: string; weight: number; color?: string }[]; className?: string }) {
  const colors = ["bg-brand", "bg-info", "bg-attention", "bg-demo", "bg-risk-4", "bg-muted-foreground"];
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        {items.map((it, i) => <div key={it.label} className={colors[i % colors.length]} style={{ width: `${it.weight * 100}%` }} title={`${it.label}: ${pct(it.weight)}`} />)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {items.map((it, i) => (
          <span key={it.label} className="flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-sm", colors[i % colors.length])} />
            {it.label} <span className="tabular text-foreground">{pct(it.weight)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function Gauge({ score, max }: { score: number; max?: number }) {
  return (
    <div className="flex items-end gap-1" aria-label={`Risco ${score} de 10`}>
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className={cn("w-2.5 rounded-sm", i < score ? "" : "bg-muted", max != null && i + 1 === max ? "ring-2 ring-foreground/40 ring-offset-1" : "")} style={{ height: 8 + i * 2.2, background: i < score ? `hsl(var(${riskColorVar(i + 1)}))` : undefined }} />
      ))}
    </div>
  );
}
