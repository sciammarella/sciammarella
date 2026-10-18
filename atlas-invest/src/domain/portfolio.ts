// Portfolio analytics: allocation, consolidated risk, scenarios, stress tests,
// liquidity, costs and concentration. Pure functions — see tests/portfolio.test.ts.

import type { AssetAnalytics } from "./analytics";
import { alignedReturns, hhi, lognormalAnnualizedPercentile, pearson, portfolioVolatility, probabilityOfLoss } from "./finance";
import { aggregate, concentrationScoreFromHHI, volatilityScore } from "./risk";
import type { AssetClass, AssetSpec, Currency, PricePoint, RiskAssessment, RiskComponent, RiskComponentKey } from "./types";

export type Bucket = "cash_br" | "cash_us" | "bond_br" | "bond_us" | "eq_br" | "eq_us" | "re_br" | "re_us" | "crypto" | "stable" | "tokenized" | "gold";

export function bucketOf(spec: AssetSpec): Bucket {
  if (spec.assetClass === "crypto") return "crypto";
  if (spec.assetClass === "stablecoin") return "stable";
  if (spec.assetClass === "tokenized") return spec.id === "GL-RWA-GOLD" ? "gold" : "tokenized";
  if ((spec.assetClass === "equity" || spec.assetClass === "etf") && !spec.duration) return spec.country === "US" ? "eq_us" : "eq_br";
  if (spec.assetClass === "reit") return spec.country === "US" ? "re_us" : "re_br";
  if ((spec.duration ?? 0) >= 1.5 || spec.assetClass === "corporate_bond") return spec.currency === "USD" ? "bond_us" : "bond_br";
  return spec.currency === "USD" ? "cash_us" : "cash_br";
}

const GROUP: Record<Bucket, string> = {
  cash_br: "cash", cash_us: "cash", bond_br: "bond", bond_us: "bond", eq_br: "eq", eq_us: "eq", re_br: "re", re_us: "re", crypto: "crypto", stable: "stable", tokenized: "tok", gold: "gold",
};

/** Assumed correlations (local currency) when history is insufficient. */
export function assumedCorrelation(a: Bucket, b: Bucket): number {
  if (a === b) return a.startsWith("cash") || a === "stable" ? 0.3 : 0.75;
  const ga = GROUP[a];
  const gb = GROUP[b];
  const key = [ga, gb].sort().join("|");
  const table: Record<string, number> = {
    "cash|cash": 0.2, "bond|cash": 0.2, "cash|eq": 0, "cash|re": 0, "cash|crypto": 0, "cash|stable": 0, "cash|tok": 0.1, "cash|gold": 0,
    "bond|bond": 0.4, "bond|eq": 0.1, "bond|re": 0.3, "bond|crypto": 0, "bond|stable": 0, "bond|tok": 0.1, "bond|gold": 0.2,
    "eq|eq": 0.55, "eq|re": 0.6, "crypto|eq": 0.35, "eq|stable": 0, "eq|tok": 0.1, "eq|gold": 0.05,
    "re|re": 0.5, "crypto|re": 0.25, "re|stable": 0, "re|tok": 0.1, "gold|re": 0.1,
    "crypto|crypto": 0.8, "crypto|stable": 0.1, "crypto|tok": 0.2, "crypto|gold": 0.15,
    "stable|stable": 0.5, "stable|tok": 0.1, "gold|stable": 0, "tok|tok": 0.3, "gold|tok": 0.2, "gold|gold": 1,
  };
  return table[key] ?? 0.2;
}

export interface HoldingInput {
  spec: AssetSpec;
  analytics: AssetAnalytics;
  valueBase: number;
  prices: PricePoint[];
  /** Where the position came from (user typed / imported file). */
  origin: "manual" | "imported";
  /** How the value was obtained. */
  valuation: "market_real" | "market_demo" | "estimated" | "manual_value";
  targetWeight?: number | null;
}

export interface StressScenario {
  id: string;
  label: string;
  description: string;
  shocks: Partial<Record<Bucket, number>>;
  /** Change in USD vs BRL (+0.3 = dollar appreciates 30%). */
  fx: number;
}

export const STRESS_SCENARIOS: StressScenario[] = [
  { id: "br_crisis", label: "Crise doméstica no Brasil", description: "Inspirado em 2015: recessão, rebaixamento soberano, juros e dólar em alta.", fx: 0.3,
    shocks: { eq_br: -0.35, re_br: -0.2, bond_br: -0.12, eq_us: -0.05, re_us: -0.05, bond_us: 0.03, crypto: -0.25, tokenized: -0.1, gold: 0.1 } },
  { id: "gfc", label: "Crise financeira global", description: "Inspirado em 2008: queda generalizada de ativos de risco e fuga para Treasuries.", fx: 0.35,
    shocks: { eq_br: -0.45, re_br: -0.25, bond_br: -0.1, eq_us: -0.45, re_us: -0.55, bond_us: 0.12, crypto: -0.7, stable: -0.03, tokenized: -0.15, gold: 0.05 } },
  { id: "crypto_winter", label: "Inverno cripto", description: "Inspirado em 2022: colapso de cripto, falhas de plataformas e perdas de paridade.", fx: 0,
    shocks: { crypto: -0.75, stable: -0.08, tokenized: -0.2, eq_us: -0.05 } },
  { id: "us_rates", label: "Choque de juros nos EUA", description: "Alta de ~300 bp nos juros americanos em 12 meses.", fx: 0.1,
    shocks: { bond_us: -0.15, eq_us: -0.18, re_us: -0.22, eq_br: -0.12, re_br: -0.08, bond_br: -0.06, crypto: -0.35, tokenized: -0.03, gold: -0.08 } },
  { id: "br_inflation", label: "Inflação persistente no Brasil", description: "Inflação acima da meta e Selic em alta por mais tempo.", fx: 0.12,
    shocks: { bond_br: -0.09, eq_br: -0.12, re_br: -0.1 } },
];

export function applyStress(h: { spec: AssetSpec; weight: number }[], s: StressScenario, base: Currency) {
  let total = 0;
  const contributions = h.map(({ spec, weight }) => {
    const local = s.shocks[bucketOf(spec)] ?? 0;
    let r = local;
    if (spec.currency !== base) r = base === "BRL" ? (1 + local) * (1 + s.fx) - 1 : (1 + local) / (1 + s.fx) - 1;
    total += weight * r;
    return { assetId: spec.id, impact: weight * r };
  });
  contributions.sort((a, b) => a.impact - b.impact);
  return { id: s.id, label: s.label, description: s.description, impact: total, worstContributors: contributions.slice(0, 3) };
}

export interface PortfolioAnalytics {
  totalValue: number;
  baseCurrency: Currency;
  holdings: { assetId: string; name: string; symbol: string; assetClass: AssetClass; value: number; weight: number; targetWeight: number | null; drift: number | null; riskScore: number; origin: string; valuation: string; currency: Currency; market: string }[];
  byClass: { key: string; weight: number; value: number }[];
  byMarket: { key: string; weight: number; value: number }[];
  byCurrency: { key: string; weight: number; value: number }[];
  bySector: { key: string; weight: number; value: number }[];
  byIssuer: { key: string; weight: number; value: number }[];
  byOrigin: { key: string; weight: number; value: number }[];
  byValuation: { key: string; weight: number; value: number }[];
  expectedReturn: number;
  volatility: number;
  range: { pessimistic: number; base: number; optimistic: number };
  probabilityOfLoss: number;
  horizonYears: number;
  correlation: { assets: string[]; matrix: (number | null)[][]; source: ("histórico" | "premissa")[][] };
  risk: RiskAssessment;
  fxExposure: number;
  liquidity: { d1: number; d5: number; d30: number; beyond: number };
  costs: { weightedFee: number; annualCost: number };
  concentration: { issuerHHI: number; topIssuer: { key: string; weight: number } | null; sectorHHI: number; countryHHI: number; currencyHHI: number };
  stress: ReturnType<typeof applyStress>[];
  riskFactors: string[];
  demoShare: number;
  estimatedShare: number;
}

function groupBy(rows: { key: string; value: number }[], total: number) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.key, (m.get(r.key) ?? 0) + r.value);
  return [...m.entries()].map(([key, value]) => ({ key, value, weight: total > 0 ? value / total : 0 })).sort((a, b) => b.value - a.value);
}

const VALUATION_LABEL: Record<HoldingInput["valuation"], string> = {
  market_real: "Cotação real",
  market_demo: "Cotação demo",
  estimated: "Estimado (curva)",
  manual_value: "Valor informado",
};

export function analyzePortfolio(inputs: HoldingInput[], base: Currency, horizonYears: number): PortfolioAnalytics | null {
  const holdings = inputs.filter((h) => h.valueBase > 0);
  const total = holdings.reduce((a, h) => a + h.valueBase, 0);
  if (total <= 0 || holdings.length === 0) return null;
  const w = holdings.map((h) => h.valueBase / total);

  // Correlation matrix: historical when both series have ≥120 overlapping returns, otherwise assumption.
  const n = holdings.length;
  const corr: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const corrSrc: ("histórico" | "premissa")[][] = Array.from({ length: n }, () => Array(n).fill("premissa"));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      if (i === j) {
        corr[i][j] = 1;
        corrSrc[i][j] = "histórico";
        continue;
      }
      let c = NaN;
      const a = holdings[i];
      const b = holdings[j];
      if (a.spec.pricing === "quoted" && b.spec.pricing === "quoted" && a.spec.currency === b.spec.currency) {
        const [ra, rb] = alignedReturns(a.prices, b.prices);
        if (ra.length >= 120) c = pearson(ra, rb);
      }
      const src = Number.isFinite(c) ? "histórico" : "premissa";
      if (!Number.isFinite(c)) c = assumedCorrelation(bucketOf(a.spec), bucketOf(b.spec));
      corr[i][j] = corr[j][i] = c;
      corrSrc[i][j] = corrSrc[j][i] = src;
    }
  }

  const mus = holdings.map((h) => h.analytics.expected?.scenarios.base ?? 0);
  const vols = holdings.map((h) => h.analytics.expected?.volatilityUsed ?? 0.2);
  const expectedReturn = w.reduce((a, wi, i) => a + wi * mus[i], 0);
  const vol = portfolioVolatility(w, vols, corr);
  const range = {
    pessimistic: lognormalAnnualizedPercentile(expectedReturn, vol, horizonYears, 0.1),
    base: expectedReturn,
    optimistic: lognormalAnnualizedPercentile(expectedReturn, vol, horizonYears, 0.9),
  };

  const rows = holdings.map((h, i) => ({
    assetId: h.spec.id, name: h.spec.name, symbol: h.spec.symbol, assetClass: h.spec.assetClass, value: h.valueBase, weight: w[i],
    targetWeight: h.targetWeight ?? null, drift: h.targetWeight != null ? w[i] - h.targetWeight : null, riskScore: h.analytics.risk.score,
    origin: h.origin, valuation: h.valuation, currency: h.spec.currency, market: h.spec.market,
  }));

  const byIssuer = groupBy(holdings.map((h) => ({ key: h.spec.issuer, value: h.valueBase })), total);
  const bySector = groupBy(holdings.map((h) => ({ key: h.spec.sector, value: h.valueBase })), total);
  const byMarket = groupBy(holdings.map((h) => ({ key: h.spec.country === "GLOBAL" ? "Global" : h.spec.country === "BR" ? "Brasil" : "EUA", value: h.valueBase })), total);
  const byCurrency = groupBy(holdings.map((h) => ({ key: h.spec.currency, value: h.valueBase })), total);

  // Issuer HHI: sovereign issuers count as diversified for concentration purposes.
  const issuerHHI = hhi(byIssuer.map((g) => (holdings.find((h) => h.spec.issuer === g.key)?.spec.credit.kind === "sovereign" ? g.weight * 0.5 : g.weight)));
  const fxExposure = holdings.reduce((a, h, i) => a + (h.spec.currency !== base || (h.spec.country !== "GLOBAL" && h.spec.country !== (base === "BRL" ? "BR" : "US")) ? w[i] : 0), 0);

  const avg = (key: RiskComponentKey, nullAs = 1) =>
    w.reduce((a, wi, i) => a + wi * (holdings[i].analytics.risk.components.find((c) => c.key === key)?.score ?? nullAs), 0);
  const fxScore = fxExposure < 0.05 ? 1 : fxExposure < 0.15 ? 2 : fxExposure < 0.3 ? 4 : fxExposure < 0.5 ? 6 : 8;
  const components: RiskComponent[] = [
    { key: "market", score: volatilityScore(vol), rationale: `Volatilidade estimada da carteira de ${(vol * 100).toFixed(1)}% a.a., considerando correlações.` },
    { key: "credit", score: Math.round(avg("credit")), rationale: "Média ponderada do risco de crédito dos emissores (ações e cripto não têm risco de crédito de emissor)." },
    { key: "liquidity", score: Math.round(avg("liquidity")), rationale: "Média ponderada do prazo de resgate." },
    { key: "fx", score: fxScore, rationale: `${(fxExposure * 100).toFixed(0)}% da carteira exposta a moeda diferente de ${base}.` },
    { key: "concentration", score: concentrationScoreFromHHI(issuerHHI), rationale: `Índice de concentração por emissor (HHI) de ${issuerHHI.toFixed(2)}; maior emissor: ${byIssuer[0].key} (${(byIssuer[0].weight * 100).toFixed(0)}%).` },
    { key: "counterparty", score: Math.round(avg("counterparty")), rationale: "Média ponderada do risco de custódia/plataforma." },
    { key: "regulatory", score: Math.round(avg("regulatory")), rationale: "Média ponderada do risco regulatório." },
    { key: "technology", score: Math.round(avg("technology")), rationale: "Peso de ativos dependentes de blockchain/smart contracts." },
  ];
  const limitations: string[] = [];
  const demoShare = holdings.reduce((a, h, i) => a + (h.valuation === "market_demo" ? w[i] : 0), 0);
  const estimatedShare = holdings.reduce((a, h, i) => a + (h.valuation === "estimated" || h.valuation === "manual_value" ? w[i] : 0), 0);
  if (demoShare > 0) limitations.push(`${(demoShare * 100).toFixed(0)}% do valor usa cotações de demonstração.`);
  if (estimatedShare > 0) limitations.push(`${(estimatedShare * 100).toFixed(0)}% do valor é estimado (curva contratual ou valor informado manualmente).`);
  const assumedPairs = corrSrc.flat().filter((s) => s === "premissa").length / 2;
  if (assumedPairs > 0) limitations.push(`${assumedPairs} par(es) de correlação usam premissas por classe, não histórico.`);
  const risk = aggregate(components, limitations);

  const liq = { d1: 0, d5: 0, d30: 0, beyond: 0 };
  holdings.forEach((h, i) => {
    const d = h.spec.lockedUntilMaturity ? 9999 : h.spec.liquidityDays;
    if (d <= 1) liq.d1 += w[i];
    else if (d <= 5) liq.d5 += w[i];
    else if (d <= 30) liq.d30 += w[i];
    else liq.beyond += w[i];
  });

  const weightedFee = w.reduce((a, wi, i) => a + wi * holdings[i].spec.feesAnnual, 0);
  const stress = STRESS_SCENARIOS.map((s) => applyStress(holdings.map((h, i) => ({ spec: h.spec, weight: w[i] })), s, base));

  const riskFactors: string[] = [];
  const worstStress = [...stress].sort((a, b) => a.impact - b.impact)[0];
  riskFactors.push(`Pior cenário de estresse: ${worstStress.label} (${(worstStress.impact * 100).toFixed(1)}%).`);
  if (byIssuer[0].weight > 0.25) riskFactors.push(`Concentração em ${byIssuer[0].key}: ${(byIssuer[0].weight * 100).toFixed(0)}% da carteira.`);
  if (fxExposure > 0.3) riskFactors.push(`Exposição cambial de ${(fxExposure * 100).toFixed(0)}%.`);
  const cryptoW = holdings.reduce((a, h, i) => a + (h.spec.assetClass === "crypto" ? w[i] : 0), 0);
  if (cryptoW > 0) riskFactors.push(`Criptoativos representam ${(cryptoW * 100).toFixed(1)}% (quedas históricas acima de 70%).`);
  if (liq.beyond > 0.3) riskFactors.push(`${(liq.beyond * 100).toFixed(0)}% sem liquidez em 30 dias.`);
  for (const c of risk.topContributors.slice(0, 2)) riskFactors.push(c);

  return {
    totalValue: total,
    baseCurrency: base,
    holdings: rows.sort((a, b) => b.value - a.value),
    byClass: groupBy(holdings.map((h) => ({ key: h.spec.assetClass, value: h.valueBase })), total),
    byMarket,
    byCurrency,
    bySector,
    byIssuer,
    byOrigin: groupBy(holdings.map((h) => ({ key: h.origin === "manual" ? "Informado manualmente" : "Importado (arquivo)", value: h.valueBase })), total),
    byValuation: groupBy(holdings.map((h) => ({ key: VALUATION_LABEL[h.valuation], value: h.valueBase })), total),
    expectedReturn,
    volatility: vol,
    range,
    probabilityOfLoss: probabilityOfLoss(expectedReturn, vol, horizonYears),
    horizonYears,
    correlation: { assets: holdings.map((h) => h.spec.symbol), matrix: corr, source: corrSrc },
    risk,
    fxExposure,
    liquidity: liq,
    costs: { weightedFee, annualCost: weightedFee * total },
    concentration: {
      issuerHHI,
      topIssuer: byIssuer[0] ? { key: byIssuer[0].key, weight: byIssuer[0].weight } : null,
      sectorHHI: hhi(bySector.map((g) => g.weight)),
      countryHHI: hhi(byMarket.map((g) => g.weight)),
      currencyHHI: hhi(byCurrency.map((g) => g.weight)),
    },
    stress,
    riskFactors,
    demoShare,
    estimatedShare,
  };
}
