import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DATA_STATUS_LABEL, type DataStatus } from "@/domain/calendar";
import { categoryFromScore } from "@/domain/risk";
import { RISK_CATEGORY_LABEL, SEVERITY_LABEL, type RiskCategory, type Severity } from "@/domain/types";
import { FlaskConical, ShieldCheck } from "lucide-react";

export function DemoBadge({ className, label = "DEMO" }: { className?: string; label?: string }) {
  return (
    <Badge variant="demo" className={cn("gap-1 font-semibold uppercase tracking-wide", className)} title="Dados simulados para demonstração — não são preços reais">
      <FlaskConical className="h-3 w-3" />
      {label}
    </Badge>
  );
}

export function OriginBadge({ origin, className }: { origin: "real" | "demo" | null | undefined; className?: string }) {
  if (origin === "demo") return <DemoBadge className={className} />;
  if (origin === "real")
    return (
      <Badge variant="brand" className={cn("gap-1", className)} title="Dados de fonte real">
        <ShieldCheck className="h-3 w-3" /> Real
      </Badge>
    );
  return <Badge variant="outline" className={className}>Sem dados</Badge>;
}

const RISK_STYLE: Record<RiskCategory, string> = {
  muito_baixo: "bg-risk-1/12 text-risk-1 border-risk-1/25",
  baixo: "bg-risk-2/12 text-risk-2 border-risk-2/25",
  moderado: "bg-risk-3/12 text-risk-3 border-risk-3/30",
  alto: "bg-risk-4/12 text-risk-4 border-risk-4/30",
  muito_alto: "bg-risk-5/12 text-risk-5 border-risk-5/30",
};

export function riskColorVar(score: number): string {
  const c = categoryFromScore(score);
  return { muito_baixo: "--risk-1", baixo: "--risk-2", moderado: "--risk-3", alto: "--risk-4", muito_alto: "--risk-5" }[c];
}

export function RiskBadge({ score, category, className, compact }: { score: number; category?: RiskCategory; className?: string; compact?: boolean }) {
  const cat = category ?? categoryFromScore(score);
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold tabular", RISK_STYLE[cat], className)}>
      {score}/10{!compact && <span className="font-medium">· {RISK_CATEGORY_LABEL[cat]}</span>}
    </span>
  );
}

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return <Badge variant={severity} className={className}>{SEVERITY_LABEL[severity]}</Badge>;
}

export function DataStatusBadge({ status }: { status: DataStatus }) {
  const variant = status === "ok" ? "brand" : status === "no_trading_day" ? "secondary" : status === "stale" ? "attention" : "critical";
  return <Badge variant={variant}>{DATA_STATUS_LABEL[status]}</Badge>;
}

export function CompatibilityBadge({ value }: { value: "alta" | "média" | "baixa" | "incompatível" }) {
  const variant = value === "alta" ? "brand" : value === "média" ? "info" : value === "baixa" ? "attention" : "critical";
  return <Badge variant={variant}>Compatibilidade {value}</Badge>;
}

export function ConfidenceBadge({ value }: { value: "baixa" | "média" | "alta" }) {
  const variant = value === "alta" ? "brand" : value === "média" ? "info" : "attention";
  return <Badge variant={variant}>Confiança {value}</Badge>;
}

const VALUATION: Record<string, { label: string; variant: "brand" | "demo" | "info" | "secondary" }> = {
  market_real: { label: "Cotação real", variant: "brand" },
  market_demo: { label: "Cotação demo", variant: "demo" },
  estimated: { label: "Estimado", variant: "info" },
  manual_value: { label: "Valor informado", variant: "secondary" },
};

export function ValuationBadge({ valuation }: { valuation: string }) {
  const v = VALUATION[valuation] ?? { label: valuation, variant: "secondary" as const };
  return <Badge variant={v.variant}>{v.label}</Badge>;
}
