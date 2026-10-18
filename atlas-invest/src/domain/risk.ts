// Atlas Risk Intelligence Engine — methodology risk-v1.0.
// Scores are 1 (lowest) to 10 (highest) per component. The overall score is a
// weighted average of the applicable components with a "weakest-link" floor so a
// single severe risk (e.g. a smart-contract or default risk) cannot be averaged away:
// overall ≥ worst market/credit score − 1 and ≥ any other component − 2.

import type { AssetSpec, Currency, RiskAssessment, RiskCategory, RiskComponent, RiskComponentKey } from "./types";
import { RISK_COMPONENT_LABEL } from "./types";

export const RISK_METHODOLOGY_VERSION = "risk-v1.0";

const WEIGHTS: Record<RiskComponentKey, number> = {
  market: 0.3,
  credit: 0.2,
  liquidity: 0.15,
  fx: 0.08,
  concentration: 0.07,
  counterparty: 0.1,
  regulatory: 0.05,
  technology: 0.05,
};

export function categoryFromScore(score: number): RiskCategory {
  if (score <= 2) return "muito_baixo";
  if (score <= 4) return "baixo";
  if (score <= 6) return "moderado";
  if (score <= 8) return "alto";
  return "muito_alto";
}

export function clampScore(n: number): number {
  return Math.min(10, Math.max(1, Math.round(n)));
}

export function volatilityScore(vol: number): number {
  const steps = [0.01, 0.03, 0.06, 0.1, 0.15, 0.2, 0.3, 0.45, 0.7];
  const idx = steps.findIndex((s) => vol < s);
  return idx === -1 ? 10 : idx + 1;
}

export function drawdownScore(dd: number): number {
  const steps = [0.01, 0.03, 0.07, 0.12, 0.2, 0.3, 0.42, 0.55, 0.7];
  const idx = steps.findIndex((s) => dd < s);
  return idx === -1 ? 10 : idx + 1;
}

const RATING_SCORE: [RegExp, number][] = [
  [/^AAA/, 2],
  [/^AA\+/, 2],
  [/^AA/, 3],
  [/^A\+|^A /, 4],
  [/^A-|^A$/, 4],
  [/^A/, 4],
  [/^BBB/, 5],
  [/^BB/, 6],
  [/^B/, 8],
];

export function ratingScore(rating: string | undefined): number | null {
  if (!rating) return null;
  for (const [re, s] of RATING_SCORE) if (re.test(rating)) return s;
  return null;
}

export function liquidityScore(days: number, locked: boolean | undefined): number {
  if (locked) return days > 365 ? 8 : 7;
  if (days <= 1) return 1;
  if (days <= 5) return 2;
  if (days <= 15) return 4;
  if (days <= 30) return 5;
  if (days <= 90) return 6;
  if (days <= 365) return 7;
  return 9;
}

export interface RiskInputs {
  spec: AssetSpec;
  baseCurrency: Currency;
  /** Annualized volatility measured from price history, if available. */
  volatility: number | null;
  /** Maximum historical drawdown, if available. */
  maxDrawdown: number | null;
  observations: number;
  isDemoData: boolean;
}

function marketComponent(i: RiskInputs): RiskComponent {
  const { spec } = i;
  if (spec.pricing === "accrual") {
    const dur = spec.duration ?? 0;
    const s = dur >= 7 ? 5 : dur >= 4 ? 4 : dur >= 1.5 ? 3 : spec.assetClass === "tokenized" ? 2 : 1;
    return {
      key: "market",
      score: s,
      rationale: dur >= 1.5
        ? `Marcação a mercado com duration de ~${dur.toFixed(1)} anos: perdas se os juros subirem e houver venda antes do vencimento.`
        : "Rendimento contratual com oscilação de preço mínima.",
    };
  }
  if (spec.assetClass === "stablecoin") {
    return { key: "market", score: 3, rationale: "Preço desenhado para manter paridade com o dólar; o risco principal é de perda de paridade (crédito/reservas)." };
  }
  const vs = i.volatility != null ? volatilityScore(i.volatility) : null;
  const ds = i.maxDrawdown != null ? drawdownScore(i.maxDrawdown) : null;
  if (vs == null && ds == null) {
    const fallback = spec.assetClass === "crypto" ? 9 : spec.assetClass === "equity" ? 7 : 6;
    return { key: "market", score: fallback, rationale: "Sem histórico suficiente; nota conservadora atribuída pela classe do ativo." };
  }
  const score = Math.max(vs ?? 0, (ds ?? 0) - 1);
  const parts: string[] = [];
  if (i.volatility != null) parts.push(`volatilidade anualizada de ${(i.volatility * 100).toFixed(1)}%`);
  if (i.maxDrawdown != null) parts.push(`queda máxima histórica de ${(i.maxDrawdown * 100).toFixed(1)}%`);
  return { key: "market", score: clampScore(score), rationale: `Baseado em ${parts.join(" e ")} (${i.observations} observações).` };
}

function creditComponent(spec: AssetSpec): RiskComponent {
  const c = spec.credit;
  switch (c.kind) {
    case "none":
      return { key: "credit", score: null, rationale: "Não há promessa de pagamento de um emissor; a perda permanente de capital é capturada no risco de mercado." };
    case "sovereign":
      return {
        key: "credit",
        score: spec.currency === "USD" && spec.country === "US" ? 1 : 2,
        rationale: `Risco soberano (${c.rating ?? "sem rating"}) em moeda local; menor risco de crédito disponível nesse mercado.`,
      };
    case "bank_insured": {
      const base = ratingScore(c.rating) ?? 4;
      return { key: "credit", score: clampScore(Math.min(base, 4)), rationale: `Emissor bancário ${c.rating ?? ""}; ${c.insuredLimit ?? "garantia de depósitos até o limite legal"}. Acima do limite, risco integral do banco.` };
    }
    case "bank_uninsured":
      return { key: "credit", score: clampScore((ratingScore(c.rating) ?? 5) + 1), rationale: "Depósito bancário sem garantia." };
    case "corporate":
      return { key: "credit", score: clampScore((ratingScore(c.rating) ?? 6) + 1), rationale: `Crédito corporativo ${c.rating ?? "sem rating"}, sem garantia de depósitos; perda esperada em inadimplência de ~${((c.lgd ?? 0.6) * 100).toFixed(0)}%.` };
    case "fund_portfolio":
      return { key: "credit", score: clampScore(ratingScore(c.rating) ?? ((c.pdAnnual ?? 0) > 0.005 ? 5 : 2)), rationale: `Carteira diversificada (${c.rating ?? "qualidade de crédito não informada"}).` };
    case "issuer_reserve":
      return { key: "credit", score: (c.pdAnnual ?? 0) >= 0.01 ? 6 : 5, rationale: `Depende da qualidade e transparência das reservas do emissor (${c.rating ?? "sem rating"}).` };
    case "spv":
      return { key: "credit", score: (c.pdAnnual ?? 0) >= 0.03 ? 8 : 6, rationale: `Veículo de securitização/tokenização sem garantia; inadimplência anual estimada de ${((c.pdAnnual ?? 0) * 100).toFixed(1)}%.` };
  }
}

function fxComponent(spec: AssetSpec, base: Currency): RiskComponent {
  if (spec.currency === base && spec.country !== (base === "BRL" ? "US" : "BR")) {
    return { key: "fx", score: 1, rationale: `Ativo denominado na sua moeda-base (${base}).` };
  }
  if (spec.currency === base) {
    return { key: "fx", score: 5, rationale: `Negociado em ${base}, mas o valor acompanha ativos de outro país (exposição cambial indireta).` };
  }
  return {
    key: "fx",
    score: 6,
    rationale: `Denominado em ${spec.currency}; o retorno na sua moeda-base (${base}) varia com o câmbio (volatilidade histórica do USD/BRL ~15% a.a.).`,
  };
}

function concentrationComponent(spec: AssetSpec): RiskComponent {
  const h = spec.holdings;
  const isSovereign = spec.credit.kind === "sovereign";
  if (isSovereign) return { key: "concentration", score: 2, rationale: "Emissor único, porém soberano." };
  if (spec.credit.kind === "bank_insured") return { key: "concentration", score: 3, rationale: "Emissor único, com garantia de depósitos até o limite legal; acima dele, a exposição ao banco é integral." };
  if (spec.assetClass === "crypto") return { key: "concentration", score: 8, rationale: "Ativo único, sem fluxo de caixa subjacente." };
  const score = h >= 300 ? 2 : h >= 50 ? 3 : h >= 15 ? 4 : h > 1 ? 5 : 7;
  return { key: "concentration", score, rationale: h > 1 ? `Exposição a ~${h} ativos subjacentes.` : "Exposição a um único emissor/empresa." };
}

function technologyComponent(spec: AssetSpec): RiskComponent {
  if (!spec.technology) return { key: "technology", score: null, rationale: "Não aplicável (sem dependência de blockchain/smart contracts)." };
  return { key: "technology", score: spec.technology.score, rationale: spec.technology.note };
}

export function assessAssetRisk(i: RiskInputs): RiskAssessment {
  const { spec } = i;
  const components: RiskComponent[] = [
    marketComponent(i),
    creditComponent(spec),
    { key: "liquidity", score: liquidityScore(spec.liquidityDays, spec.lockedUntilMaturity), rationale: spec.lockedUntilMaturity ? `Resgate apenas no vencimento${spec.maturity ? ` (${spec.maturity})` : ""}; venda antecipada pode não ser possível.` : `Recursos disponíveis em cerca de D+${spec.liquidityDays}.` },
    fxComponent(spec, i.baseCurrency),
    concentrationComponent(spec),
    { key: "counterparty", score: spec.counterparty.score, rationale: spec.counterparty.note },
    { key: "regulatory", score: spec.regulatory.score, rationale: spec.regulatory.note },
    technologyComponent(spec),
  ];
  return aggregate(components, collectLimitations(i));
}

export function aggregate(components: RiskComponent[], limitations: string[]): RiskAssessment {
  const applicable = components.filter((c) => c.score != null) as (RiskComponent & { score: number })[];
  const wsum = applicable.reduce((a, c) => a + WEIGHTS[c.key], 0);
  const weighted = applicable.reduce((a, c) => a + WEIGHTS[c.key] * c.score, 0) / (wsum || 1);
  const worst = applicable.reduce((m, c) => Math.max(m, c.score), 1);
  // Market and credit drive permanent capital loss, so they get a tighter floor.
  const floor = Math.max(...applicable.map((c) => c.score - (c.key === "market" || c.key === "credit" ? 1 : 2)), 1);
  const score = clampScore(Math.max(weighted, floor));
  const category = categoryFromScore(score);

  const ranked = [...applicable].sort((a, b) => WEIGHTS[b.key] * b.score + b.score / 10 - (WEIGHTS[a.key] * a.score + a.score / 10));
  const topContributors = ranked
    .filter((c) => c.score >= 4)
    .slice(0, 3)
    .map((c) => `${RISK_COMPONENT_LABEL[c.key]} (${c.score}/10): ${c.rationale}`);

  const floorApplied = floor > weighted;
  const floorComponent = applicable.find((c) => c.score - (c.key === "market" || c.key === "credit" ? 1 : 2) === floor) ?? ranked[0];
  const explanation =
    `Nota ${score}/10 (${category.replace("_", " ")}). ` +
    (floorApplied
      ? `A nota foi elevada pelo componente mais severo (${RISK_COMPONENT_LABEL[floorComponent.key].toLowerCase()} ${floorComponent.score}/10): riscos graves não são diluídos pela média.`
      : `Média ponderada dos componentes aplicáveis${topContributors.length ? `, puxada principalmente por ${ranked.slice(0, 2).map((c) => RISK_COMPONENT_LABEL[c.key].toLowerCase()).join(" e ")}` : ""}.`);

  return { score, category, components, topContributors, explanation, limitations, methodologyVersion: RISK_METHODOLOGY_VERSION };
}

function collectLimitations(i: RiskInputs): string[] {
  const out: string[] = [];
  if (i.isDemoData) out.push("Métricas de mercado calculadas sobre dados de DEMONSTRAÇÃO (simulados).");
  if (i.spec.pricing === "quoted" && i.observations < 250) out.push(`Histórico curto (${i.observations} observações); volatilidade e drawdown podem estar subestimados.`);
  if (i.spec.pricing === "accrual") out.push("Ativo avaliado pela curva contratual (valor estimado), não por cotação de mercado.");
  if (!i.spec.credit.rating && i.spec.credit.kind !== "none") out.push("Sem rating de crédito disponível.");
  out.push("Características do produto (taxas, rating, liquidez) são cadastrais e precisam ser confirmadas na documentação oficial.");
  return out;
}

/** Portfolio-level concentration score from issuer-level weights. */
export function concentrationScoreFromHHI(hhiValue: number): number {
  if (hhiValue < 0.06) return 2;
  if (hhiValue < 0.1) return 3;
  if (hhiValue < 0.15) return 4;
  if (hhiValue < 0.25) return 6;
  if (hhiValue < 0.4) return 8;
  return 9;
}
