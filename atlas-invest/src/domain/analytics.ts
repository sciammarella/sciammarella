// Asset analytics: historical metrics, expected-return scenarios and data quality.
// Methodology "atlas-cma-v1.0" (capital market assumptions). Projections are
// model outputs, never guarantees, and are labelled as such everywhere in the UI.

import {
  annualizedVolatility,
  brRegressiveTaxRate,
  cagr,
  compound,
  lognormalAnnualizedPercentile,
  maxDrawdown,
  probabilityOfLoss,
  yearsBetween,
} from "./finance";
import { assessAssetRisk } from "./risk";
import type { DataStatus } from "./calendar";
import type { AssetSpec, Currency, DataOrigin, HorizonKind, MacroSnapshot, PricePoint, RiskAssessment } from "./types";

export const CMA_METHODOLOGY_VERSION = "atlas-cma-v1.0";

export const HORIZON_YEARS: Record<HorizonKind, number> = { lt1: 0.5, "1to3": 2, "3to5": 4, gt5: 7 };
export const HORIZON_LABEL: Record<HorizonKind, string> = { lt1: "Menos de 1 ano", "1to3": "1 a 3 anos", "3to5": "3 a 5 anos", gt5: "Mais de 5 anos" };

/** Risk premium over the local short-term risk-free rate, by asset type. */
export function riskPremium(spec: AssetSpec): { premium: number; note: string } {
  const { assetClass, market, country, id } = spec;
  if (id === "GL-RWA-GOLD") return { premium: -0.01, note: "Ouro: sem fluxo de caixa; premissa de retorno ~1 p.p. abaixo do T-Bill no longo prazo." };
  switch (assetClass) {
    case "equity":
    case "etf":
      if (spec.duration) {
        return { premium: spec.duration > 10 ? 0.006 : 0.003, note: "Prêmio de prazo de Treasuries: 0,3–0,6 p.p. sobre o T-Bill." };
      }
      if (country === "BR" || (market === "BR" && country !== "US")) return { premium: 0.05, note: "Prêmio de risco de ações brasileiras: 5 p.p. sobre o CDI (premissa CMA)." };
      return { premium: 0.045, note: "Prêmio de risco de ações americanas: 4,5 p.p. sobre o T-Bill (premissa CMA)." };
    case "reit":
      if (spec.credit.kind === "fund_portfolio") return { premium: 0.015, note: "FII de recebíveis: spread de crédito de ~1,5 p.p. sobre o CDI, antes de perdas." };
      return { premium: country === "BR" ? 0.03 : 0.035, note: "Prêmio de risco imobiliário listado: 3–3,5 p.p. (premissa CMA)." };
    case "corporate_bond":
      return { premium: 0.012, note: "Spread de crédito grau de investimento: ~1,2 p.p. sobre o T-Bill." };
    case "treasury_us":
      return { premium: 0.003, note: "Prêmio de prazo de Treasuries de média duração." };
    case "crypto":
      return { premium: 0, note: "Atlas NÃO assume prêmio de risco positivo para criptoativos: não há fluxo de caixa que permita estimá-lo. O cenário-base é igual à taxa livre de risco e a faixa de cenários reflete apenas a volatilidade." };
    case "stablecoin":
      return { premium: 0, note: "Stablecoin não remunera por si só; rendimentos de plataformas envolvem risco adicional de contraparte." };
    default:
      return { premium: 0.01, note: "Prêmio genérico de 1 p.p." };
  }
}

/** Contractual nominal yield of an accrual instrument given current macro levels. */
export function contractualYield(spec: AssetSpec, macro: MacroSnapshot): number | null {
  const y = spec.yield;
  if (!y) return null;
  switch (y.type) {
    case "cdi_pct":
      return y.value * macro.cdi;
    case "selic_spread":
      return macro.selic + y.value;
    case "ipca_spread":
      return compound(macro.ipca12m, y.value);
    case "prefixed":
    case "usd_fixed":
      return y.value;
    case "tbill_spread":
      return macro.ust3m + y.value;
  }
}

export function riskFreeRate(currency: Currency, macro: MacroSnapshot): number {
  return currency === "BRL" ? macro.cdi : macro.ust3m;
}

const DEFAULT_SIGMA: Record<string, number> = {
  equity: 0.3, etf: 0.2, reit: 0.18, crypto: 0.7, stablecoin: 0.01, corporate_bond: 0.08, treasury_us: 0.05, tokenized: 0.1, fund: 0.01,
};

/** Assumed correlation between the asset (in local currency) and USD/BRL moves. */
function fxCorrelation(spec: AssetSpec): number {
  if (spec.assetClass === "crypto") return -0.1;
  if (["equity", "etf", "reit"].includes(spec.assetClass) && !spec.duration) return spec.country === "BR" ? 0.3 : -0.3;
  return 0;
}

export const FX_VOL_USDBRL = 0.15;

export interface AssetMarketData {
  prices: PricePoint[];
  origin: DataOrigin | null;
  sourceName: string | null;
  lastUpdated: string | null;
  status: DataStatus;
}

export interface Scenario {
  pessimistic: number;
  base: number;
  optimistic: number;
}

export interface AssetAnalytics {
  assetId: string;
  baseCurrency: Currency;
  horizonYears: number;
  lastPrice: number | null;
  lastPriceDate: string | null;
  historical: null | {
    observations: number;
    from: string;
    to: string;
    return1y: number | null;
    cagr3y: number | null;
    volatility: number;
    maxDrawdown: number;
  };
  expected: {
    scenarios: Scenario; // annualized, in the investor's base currency
    afterTaxBase: number | null;
    probabilityOfLoss: number | null;
    probabilityOfLossNote: string;
    volatilityUsed: number;
    volatilitySource: "histórico" | "premissa da classe" | "duration";
    methodology: string[];
    fxAdjusted: boolean;
  } | null;
  insufficientData: string[];
  risk: RiskAssessment;
  dataQuality: { score: number; label: "alta" | "média" | "baixa"; issues: string[] };
  market: { origin: DataOrigin | null; sourceName: string | null; lastUpdated: string | null; status: DataStatus };
}

export function analyzeAsset(spec: AssetSpec, md: AssetMarketData, macro: MacroSnapshot, baseCurrency: Currency, horizonYears: number): AssetAnalytics {
  const insufficient: string[] = [];
  const prices = md.prices;
  const closes = prices.map((p) => p.close);
  const isDemo = md.origin === "demo";

  // ── Historical metrics (only for quoted instruments with enough history) ──
  let historical: AssetAnalytics["historical"] = null;
  if (spec.pricing === "quoted" && prices.length >= 60) {
    const last = prices[prices.length - 1];
    const oneYearAgo = prices.find((p) => yearsBetween(p.date, last.date) <= 1.0);
    const threeYearsAgo = prices[0] && yearsBetween(prices[0].date, last.date) >= 2.95 ? prices[0] : null;
    historical = {
      observations: prices.length,
      from: prices[0].date,
      to: last.date,
      return1y: oneYearAgo && yearsBetween(prices[0].date, last.date) >= 0.98 ? last.close / oneYearAgo.close - 1 : null,
      cagr3y: threeYearsAgo ? cagr(threeYearsAgo.close, last.close, yearsBetween(threeYearsAgo.date, last.date)) : null,
      volatility: annualizedVolatility(closes, spec.assetClass === "crypto" || spec.assetClass === "stablecoin" || spec.market === "GLOBAL" ? 365 : 252),
      maxDrawdown: maxDrawdown(closes),
    };
    if (historical.return1y == null) insufficient.push("Retorno de 12 meses: histórico inferior a 1 ano.");
    if (historical.cagr3y == null) insufficient.push("Retorno anualizado de 3 anos: histórico inferior a 3 anos.");
  } else if (spec.pricing === "quoted") {
    insufficient.push("Histórico de preços insuficiente (menos de 60 observações) para volatilidade e drawdown.");
  }

  // ── Expected return & scenarios ──
  const methodology: string[] = [];
  const rfLocal = riskFreeRate(spec.currency, macro);
  let mu: number;
  let sigma: number;
  let sigmaSource: "histórico" | "premissa da classe" | "duration";
  let pessimisticExtra = 0;
  let creditLoss = 0;
  let accrualSpread: Scenario | null = null;

  if (spec.pricing === "accrual") {
    const nominal = contractualYield(spec, macro);
    if (nominal == null) {
      insufficient.push("Taxa contratual não informada.");
      mu = rfLocal;
    } else {
      creditLoss = (spec.credit.pdAnnual ?? 0) * (spec.credit.lgd ?? 0.5);
      const insured = spec.credit.kind === "bank_insured";
      const expectedLoss = insured ? creditLoss * 0.2 : creditLoss;
      mu = nominal - spec.feesAnnual - expectedLoss;
      methodology.push(`Taxa contratual de ${(nominal * 100).toFixed(2)}% a.a. calculada a partir de ${describeYield(spec, macro)}.`);
      if (spec.feesAnnual > 0) methodology.push(`Menos custos de ${(spec.feesAnnual * 100).toFixed(2)}% a.a.`);
      if (expectedLoss > 0) methodology.push(`Menos perda esperada de crédito de ${(expectedLoss * 100).toFixed(2)}% a.a. (prob. de inadimplência × perda dado inadimplência${insured ? ", reduzida pela garantia de depósitos" : ""}).`);
      const stressLoss = Math.min(0.5, (spec.credit.pdAnnual ?? 0) * 4 * (spec.credit.lgd ?? 0.5)) * (insured ? 0.2 : 1);
      const dur = spec.duration ?? 0;
      const mtm = dur >= 1 ? (dur * 0.02) / Math.max(horizonYears, 0.5) : 0;
      const ipcaDown = spec.yield?.type === "ipca_spread" ? 0.02 : 0;
      accrualSpread = {
        pessimistic: mu - stressLoss - Math.min(mtm, 0.25) - ipcaDown,
        base: mu,
        optimistic: mu + (dur >= 1 ? Math.min((dur * 0.01) / Math.max(horizonYears, 0.5), 0.1) : 0) + (spec.yield?.type === "ipca_spread" ? 0.015 : 0),
      };
      if (mtm > 0) methodology.push(`Cenário pessimista inclui alta de 2 p.p. nos juros com venda antes do vencimento (duration ${dur.toFixed(1)}).`);
      if (stressLoss > 0) methodology.push("Cenário pessimista inclui perda de crédito em estresse (4× a probabilidade base).");
    }
    sigma = spec.duration ? spec.duration * 0.012 : 0.004;
    sigmaSource = "duration";
  } else {
    const { premium, note } = riskPremium(spec);
    mu = rfLocal + premium - spec.feesAnnual;
    if (spec.assetClass === "stablecoin") {
      creditLoss = (spec.credit.pdAnnual ?? 0) * (spec.credit.lgd ?? 0.2);
      mu = -spec.feesAnnual - creditLoss;
      methodology.push("Stablecoin: retorno-base em dólar = 0 menos custos e perda esperada por perda de paridade.");
    } else {
      methodology.push(`Taxa livre de risco em ${spec.currency}: ${(rfLocal * 100).toFixed(2)}% a.a. (${spec.currency === "BRL" ? "CDI" : "T-Bill 3M"}).`);
      methodology.push(note);
      if (spec.feesAnnual > 0) methodology.push(`Menos custos de ${(spec.feesAnnual * 100).toFixed(2)}% a.a.`);
    }
    if (historical && historical.observations >= 120 && Number.isFinite(historical.volatility)) {
      sigma = historical.volatility;
      sigmaSource = "histórico";
    } else {
      sigma = DEFAULT_SIGMA[spec.assetClass] ?? 0.2;
      sigmaSource = "premissa da classe";
      insufficient.push("Volatilidade baseada em premissa da classe, não no histórico do ativo.");
    }
    methodology.push(`Cenários = percentis 10/90 de um modelo lognormal com volatilidade de ${(sigma * 100).toFixed(1)}% a.a. (${sigmaSource}), anualizados no horizonte de ${horizonYears} ano(s).`);
  }

  // ── Currency translation into the investor's base currency ──
  let fxAdjusted = false;
  let muBase = mu;
  let sigmaBase = sigma;
  if (spec.currency !== baseCurrency) {
    fxAdjusted = true;
    const rfBase = riskFreeRate(baseCurrency, macro);
    const drift = (1 + rfBase) / (1 + rfLocal) - 1;
    muBase = compound(mu, drift);
    const rho = fxCorrelation(spec);
    sigmaBase = Math.sqrt(sigma ** 2 + FX_VOL_USDBRL ** 2 + 2 * rho * sigma * FX_VOL_USDBRL);
    methodology.push(
      `Conversão para ${baseCurrency}: variação cambial esperada de ${(drift * 100).toFixed(1)}% a.a. implícita no diferencial de juros (paridade coberta), com volatilidade cambial de ${(FX_VOL_USDBRL * 100).toFixed(0)}% a.a.`,
    );
  }

  let scenarios: Scenario;
  if (accrualSpread && !fxAdjusted) {
    scenarios = accrualSpread;
  } else if (accrualSpread && fxAdjusted) {
    const rfBase = riskFreeRate(baseCurrency, macro);
    const drift = (1 + rfBase) / (1 + rfLocal) - 1;
    scenarios = {
      pessimistic: lognormalAnnualizedPercentile(compound(accrualSpread.pessimistic, drift), sigmaBase, horizonYears, 0.1),
      base: muBase,
      optimistic: lognormalAnnualizedPercentile(compound(accrualSpread.optimistic, drift), sigmaBase, horizonYears, 0.9),
    };
  } else {
    scenarios = {
      pessimistic: lognormalAnnualizedPercentile(muBase, sigmaBase, horizonYears, 0.1) + pessimisticExtra,
      base: muBase,
      optimistic: lognormalAnnualizedPercentile(muBase, sigmaBase, horizonYears, 0.9),
    };
  }

  // ── Probability of loss ──
  let pLoss: number | null = null;
  let pLossNote: string;
  const hasHistoryForProb = spec.pricing === "accrual" || sigmaSource === "histórico";
  if (!hasHistoryForProb) {
    pLossNote = "Dados insuficientes: probabilidade de perda não estimada sem histórico de preços do próprio ativo.";
  } else if (spec.pricing === "accrual" && !fxAdjusted) {
    const pd = spec.credit.pdAnnual ?? 0;
    const insured = spec.credit.kind === "bank_insured" ? 0.2 : 1;
    const holdToMaturity = !spec.duration || spec.duration < 1.5 || (spec.minHorizonYears ?? 0) <= horizonYears;
    if (holdToMaturity) {
      pLoss = (1 - (1 - pd) ** horizonYears) * insured;
      pLossNote = "Probabilidade de perda nominal por inadimplência no horizonte, mantendo até o vencimento (não inclui perda de poder de compra).";
    } else {
      pLoss = probabilityOfLoss(muBase, sigmaBase, horizonYears);
      pLossNote = "Inclui risco de marcação a mercado por venda antes do vencimento (modelo lognormal).";
    }
  } else {
    pLoss = probabilityOfLoss(muBase, sigmaBase, horizonYears);
    pLossNote = `Probabilidade de terminar o horizonte de ${horizonYears} ano(s) com retorno nominal negativo em ${baseCurrency} (modelo lognormal; não captura eventos extremos além da volatilidade histórica).`;
  }

  // ── After-tax estimate (Brazilian regimes only; others depend on residency) ──
  let afterTax: number | null = null;
  const days = horizonYears * 365;
  switch (spec.tax.regime) {
    case "br_regressive":
      afterTax = scenarios.base * (1 - brRegressiveTaxRate(days));
      break;
    case "br_exempt_pf":
      afterTax = spec.assetClass === "reit" ? scenarios.base * 0.95 : scenarios.base;
      break;
    case "br_equity_15":
    case "br_crypto":
      afterTax = scenarios.base * 0.85;
      break;
    default:
      afterTax = null;
  }
  if (baseCurrency === "USD" && spec.tax.regime.startsWith("br_")) afterTax = null;

  const risk = assessAssetRisk({
    spec,
    baseCurrency,
    volatility: historical?.volatility ?? null,
    maxDrawdown: historical?.maxDrawdown ?? null,
    observations: prices.length,
    isDemoData: isDemo,
  });

  const dq = dataQuality(spec, md, sigmaSource);
  const last = prices[prices.length - 1];

  return {
    assetId: spec.id,
    baseCurrency,
    horizonYears,
    lastPrice: last?.close ?? null,
    lastPriceDate: last?.date ?? null,
    historical,
    expected: {
      scenarios,
      afterTaxBase: afterTax,
      probabilityOfLoss: pLoss,
      probabilityOfLossNote: pLossNote,
      volatilityUsed: sigmaBase,
      volatilitySource: sigmaSource,
      methodology,
      fxAdjusted,
    },
    insufficientData: insufficient,
    risk,
    dataQuality: dq,
    market: { origin: md.origin, sourceName: md.sourceName, lastUpdated: md.lastUpdated, status: md.status },
  };
}

function describeYield(spec: AssetSpec, macro: MacroSnapshot): string {
  const y = spec.yield!;
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  switch (y.type) {
    case "cdi_pct":
      return `${(y.value * 100).toFixed(0)}% do CDI (CDI atual ${pct(macro.cdi)})`;
    case "selic_spread":
      return `Selic (${pct(macro.selic)}) + ${pct(y.value)}`;
    case "ipca_spread":
      return `IPCA 12m (${pct(macro.ipca12m)}, usado como proxy da inflação futura) + ${pct(y.value)}`;
    case "prefixed":
      return `taxa prefixada de ${pct(y.value)}`;
    case "usd_fixed":
      return `taxa fixa de ${pct(y.value)} em USD`;
    case "tbill_spread":
      return `T-Bill 3M (${pct(macro.ust3m)})${y.value ? ` ${y.value > 0 ? "+" : "−"} ${pct(Math.abs(y.value))}` : ""}`;
  }
}

export function dataQuality(spec: AssetSpec, md: AssetMarketData, sigmaSource: string): AssetAnalytics["dataQuality"] {
  let score = 100;
  const issues: string[] = [];
  if (md.origin === "demo") {
    score -= 40;
    issues.push("Preços de demonstração (simulados).");
  }
  if (md.status === "stale") {
    score -= 20;
    issues.push("Dados desatualizados em relação ao último pregão.");
  }
  if (md.status === "source_unavailable") {
    score -= 25;
    issues.push("Fonte de dados indisponível na última tentativa.");
  }
  if (md.status === "no_data") {
    score -= 40;
    issues.push("Sem dados de preço.");
  }
  if (spec.pricing === "quoted" && md.prices.length < 250) {
    score -= 15;
    issues.push("Histórico inferior a 1 ano.");
  }
  if (sigmaSource === "premissa da classe") {
    score -= 10;
    issues.push("Volatilidade estimada por premissa da classe.");
  }
  if (spec.pricing === "accrual") {
    score -= 10;
    issues.push("Valor estimado pela curva contratual.");
  }
  score = Math.max(0, score);
  return { score, label: score >= 75 ? "alta" : score >= 50 ? "média" : "baixa", issues };
}
