// Portfolio Builder — deterministic proposal generator (builder-v1.0).
// Produces conservative / balanced / aggressive allocations that respect the
// investor's constraints. The target return never loosens a constraint: if no
// compatible proposal reaches it, the result says so explicitly.

import type { AssetAnalytics } from "./analytics";
import { bucketOf, type Bucket } from "./portfolio";
import type { Opportunity } from "./discovery";
import type { AssetSpec, DerivedProfile, ProfileAnswers } from "./types";

export const BUILDER_METHODOLOGY_VERSION = "builder-v1.0";

export type Strategy = "conservative" | "balanced" | "aggressive";
export const STRATEGY_LABEL: Record<Strategy, string> = { conservative: "Conservadora", balanced: "Equilibrada", aggressive: "Agressiva" };

type Sleeve = "cash" | "fixed" | "equity" | "real_estate" | "crypto" | "tokenized";

const TEMPLATES: Record<Strategy, Record<Sleeve, number>> = {
  conservative: { cash: 0.45, fixed: 0.4, equity: 0.1, real_estate: 0.05, crypto: 0, tokenized: 0 },
  balanced: { cash: 0.2, fixed: 0.33, equity: 0.32, real_estate: 0.1, crypto: 0.03, tokenized: 0.02 },
  aggressive: { cash: 0.07, fixed: 0.15, equity: 0.53, real_estate: 0.1, crypto: 0.1, tokenized: 0.05 },
};

const PICKS: Record<Sleeve, number> = { cash: 2, fixed: 3, equity: 4, real_estate: 2, crypto: 2, tokenized: 1 };

export function sleeveOf(b: Bucket, spec: AssetSpec): Sleeve {
  switch (b) {
    case "cash_br":
    case "cash_us":
      return spec.lockedUntilMaturity ? "fixed" : "cash";
    case "bond_br":
    case "bond_us":
      return "fixed";
    case "eq_br":
    case "eq_us":
      return "equity";
    case "re_br":
    case "re_us":
      return "real_estate";
    case "crypto":
    case "stable":
      return "crypto";
    case "tokenized":
    case "gold":
      return "tokenized";
  }
}

export interface Candidate {
  spec: AssetSpec;
  analytics: AssetAnalytics;
  opportunity: Opportunity;
}

export interface ProposalLine {
  assetId: string;
  weight: number;
  sleeve: Sleeve;
  rationale: string;
}

export interface Proposal {
  strategy: Strategy;
  label: string;
  lines: ProposalLine[];
  notes: string[];
}

const MAX_SINGLE = 0.25;
const MAX_SOVEREIGN = 0.45;

function rankScore(c: Candidate, strategy: Strategy, a: ProfileAnswers): number {
  // Home bias for the defensive sleeves: interest-parity drift makes foreign bonds look
  // like local yield plus premium, but they add currency risk the investor did not ask for.
  const sleeve = sleeveOf(bucketOf(c.spec), c.spec);
  const fxPenalty = c.spec.currency !== a.baseCurrency ? (sleeve === "cash" || sleeve === "fixed" ? 0.05 : 0.005) : 0;
  const base = c.analytics.expected?.scenarios.base ?? 0;
  const risk = c.analytics.risk.score;
  const quality = c.analytics.dataQuality.score / 100;
  const diversified = c.spec.holdings >= 50 ? 0.03 : 0;
  // Beginners: prefer diversified ETFs over single names.
  const beginnerPenalty = (a.experience === "none" || a.experience === "basic") && c.spec.holdings === 1 && c.spec.assetClass === "equity" ? 0.04 : 0;
  const riskAversion = strategy === "conservative" ? 0.012 : strategy === "balanced" ? 0.006 : 0.002;
  return base - riskAversion * risk + diversified - beginnerPenalty - fxPenalty + 0.01 * quality + c.opportunity.compatibilityScore / 5000;
}

export function buildProposal(strategy: Strategy, candidates: Candidate[], a: ProfileAnswers, p: DerivedProfile): Proposal {
  const notes: string[] = [];
  const usable = candidates.filter((c) => c.opportunity.eligible);
  const bySleeve = new Map<Sleeve, Candidate[]>();
  for (const c of usable) {
    const s = sleeveOf(bucketOf(c.spec), c.spec);
    if (s === "crypto" && c.spec.assetClass === "stablecoin") continue; // stablecoins are a cash tool, not a growth sleeve
    // Conservative/balanced proposals avoid assets far above the investor's risk limit.
    const limit = strategy === "aggressive" ? p.maxRiskScore + 3 : strategy === "balanced" ? p.maxRiskScore + 2 : p.maxRiskScore + 1;
    if (c.analytics.risk.score > limit && s !== "crypto") continue;
    if (c.spec.lockedUntilMaturity && a.liquidityNeed === "daily" && s === "cash") continue;
    if (c.spec.minHorizonYears && c.spec.minHorizonYears > p.horizonYears + 1) continue;
    if (!bySleeve.has(s)) bySleeve.set(s, []);
    bySleeve.get(s)!.push(c);
  }

  // Sleeve weights from template, then caps from the profile.
  const sleeves = { ...TEMPLATES[strategy] };
  sleeves.crypto = Math.min(sleeves.crypto, p.maxCryptoWeight);
  sleeves.tokenized = Math.min(sleeves.tokenized, p.maxTokenizedWeight);
  if (strategy !== "conservative" && p.level <= 1) {
    sleeves.equity = Math.min(sleeves.equity, 0.15);
    sleeves.real_estate = Math.min(sleeves.real_estate, 0.05);
  }
  for (const s of Object.keys(sleeves) as Sleeve[]) {
    if (!bySleeve.get(s)?.length && sleeves[s] > 0) {
      notes.push(`Sem ativos elegíveis para a parcela de ${sleeveLabel(s)}; peso redistribuído.`);
      sleeves[s] = 0;
    }
  }
  // Liquidity floor: ensure the cash sleeve covers the minimum liquid weight.
  if (sleeves.cash < p.minLiquidWeight && bySleeve.get("cash")?.length) {
    const need = p.minLiquidWeight - sleeves.cash;
    notes.push(`Parcela de liquidez elevada para ${(p.minLiquidWeight * 100).toFixed(0)}% por causa da sua necessidade de liquidez.`);
    sleeves.cash = p.minLiquidWeight;
    let remaining = need;
    for (const s of ["equity", "fixed", "real_estate", "tokenized", "crypto"] as Sleeve[]) {
      const cut = Math.min(sleeves[s], remaining);
      sleeves[s] -= cut;
      remaining -= cut;
      if (remaining <= 0) break;
    }
  }
  const sum = Object.values(sleeves).reduce((x, y) => x + y, 0);
  for (const s of Object.keys(sleeves) as Sleeve[]) sleeves[s] = sum > 0 ? sleeves[s] / sum : 0;
  // Renormalization must not push capped sleeves above the profile limits.
  const capped: [Sleeve, number][] = [["crypto", p.maxCryptoWeight], ["tokenized", p.maxTokenizedWeight]];
  for (const [s, cap] of capped) {
    if (sleeves[s] > cap) {
      const excess = sleeves[s] - cap;
      sleeves[s] = cap;
      const sink: Sleeve = sleeves.fixed > 0 ? "fixed" : "cash";
      sleeves[sink] += excess;
    }
  }

  const lines: ProposalLine[] = [];
  for (const s of Object.keys(sleeves) as Sleeve[]) {
    const sw = sleeves[s];
    if (sw <= 0) continue;
    let pool = [...(bySleeve.get(s) ?? [])].sort((x, y) => rankScore(y, strategy, a) - rankScore(x, strategy, a));
    if (s === "crypto") pool = pool.sort((x, y) => x.analytics.risk.score - y.analytics.risk.score || rankScore(y, strategy, a) - rankScore(x, strategy, a));
    // Market diversification for equity when both markets are allowed.
    let picks: Candidate[];
    if (s === "equity" && a.markets.length > 1) {
      const br = pool.filter((c) => c.spec.country === "BR");
      const us = pool.filter((c) => c.spec.country === "US");
      const k = PICKS.equity / 2;
      picks = [...br.slice(0, k), ...us.slice(0, k)];
    } else {
      picks = pool.slice(0, PICKS[s]);
    }
    if (picks.length === 0) continue;
    // Inverse-risk weighting inside the sleeve.
    const inv = picks.map((c) => 1 / Math.max(1, c.analytics.risk.score));
    const invSum = inv.reduce((x, y) => x + y, 0);
    picks.forEach((c, i) => {
      lines.push({ assetId: c.spec.id, weight: (sw * inv[i]) / invSum, sleeve: s, rationale: lineRationale(c, s) });
    });
  }

  capAndNormalize(lines, candidates, new Set(["crypto", "tokenized"]));
  return { strategy, label: STRATEGY_LABEL[strategy], lines: lines.filter((l) => l.weight >= 0.005).sort((x, y) => y.weight - x.weight), notes };
}

/** Enforce single-asset caps, redistributing the excess pro rata to uncapped lines. */
export function capAndNormalize(lines: ProposalLine[], candidates: Candidate[], fixedSleeves: Set<string> = new Set()): void {
  const isSovereign = (id: string) => candidates.find((c) => c.spec.id === id)?.spec.credit.kind === "sovereign";
  for (let iter = 0; iter < 10; iter++) {
    let excess = 0;
    for (const l of lines) {
      const cap = isSovereign(l.assetId) ? MAX_SOVEREIGN : MAX_SINGLE;
      if (l.weight > cap) {
        excess += l.weight - cap;
        l.weight = cap;
      }
    }
    if (excess < 1e-9) break;
    const open = lines.filter((l) => !fixedSleeves.has(l.sleeve) && l.weight < (isSovereign(l.assetId) ? MAX_SOVEREIGN : MAX_SINGLE) - 1e-9);
    const openSum = open.reduce((x, l) => x + l.weight, 0);
    if (openSum <= 0) break;
    for (const l of open) l.weight += (excess * l.weight) / openSum;
  }
  // Any residual goes to the unrestricted lines only.
  const total = lines.reduce((x, l) => x + l.weight, 0);
  const free = lines.filter((l) => !fixedSleeves.has(l.sleeve));
  const freeSum = free.reduce((x, l) => x + l.weight, 0);
  if (total > 0 && freeSum > 0) for (const l of free) l.weight *= (freeSum + 1 - total) / freeSum;
}

function sleeveLabel(s: Sleeve): string {
  return { cash: "liquidez", fixed: "renda fixa", equity: "ações/ETFs", real_estate: "imobiliário", crypto: "cripto", tokenized: "tokenizados" }[s];
}

function lineRationale(c: Candidate, s: Sleeve): string {
  const sc = c.analytics.expected?.scenarios;
  const role = {
    cash: "Reserva de liquidez com baixa oscilação",
    fixed: "Renda fixa para previsibilidade de retorno",
    equity: "Motor de crescimento de longo prazo",
    real_estate: "Renda recorrente e diversificação imobiliária",
    crypto: "Exposição pequena e assimétrica a criptoativos",
    tokenized: "Diversificação via ativo tokenizado",
  }[s];
  return `${role}. Risco ${c.analytics.risk.score}/10${sc ? `, cenário-base ${(sc.base * 100).toFixed(1)}% a.a.` : ""}.`;
}

export interface FeasibilityResult {
  status: "compatível" | "desafiadora" | "incompatível";
  message: string;
  bestCompatibleReturn: number | null;
}

export function assessTargetFeasibility(target: number, proposals: { strategy: Strategy; expectedReturn: number; riskScore: number; compatible: boolean }[]): FeasibilityResult {
  const compatible = proposals.filter((p) => p.compatible);
  const best = compatible.reduce<number | null>((m, p) => (m == null || p.expectedReturn > m ? p.expectedReturn : m), null);
  if (best == null) {
    return { status: "incompatível", bestCompatibleReturn: null, message: "Nenhuma das alternativas respeita todos os limites do seu perfil com os ativos elegíveis disponíveis. Revise mercados e classes permitidas." };
  }
  if (best >= target) {
    return { status: "compatível", bestCompatibleReturn: best, message: `Há alternativa compatível com seu perfil cujo cenário-base (${(best * 100).toFixed(1)}% a.a.) alcança a meta de ${(target * 100).toFixed(1)}%. Cenário-base não é garantia.` };
  }
  if (best >= target * 0.85) {
    return { status: "desafiadora", bestCompatibleReturn: best, message: `A meta de ${(target * 100).toFixed(1)}% está um pouco acima do melhor cenário-base compatível (${(best * 100).toFixed(1)}% a.a.). Alcançá-la exigiria mais risco do que seu perfil comporta.` };
  }
  return {
    status: "incompatível",
    bestCompatibleReturn: best,
    message: `A meta de ${(target * 100).toFixed(1)}% a.a. não é compatível com o seu perfil de risco. O maior retorno esperado entre as alternativas compatíveis é ${(best * 100).toFixed(1)}% a.a. Não vamos sugerir ativos mais arriscados apenas para atingir a meta.`,
  };
}
