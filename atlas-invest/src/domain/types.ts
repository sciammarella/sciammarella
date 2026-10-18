// Shared domain types. Everything in src/domain is pure and deterministic so it
// can be unit-tested without a database and reused by the AI agent's tools.

export type Currency = "BRL" | "USD";
export type Market = "BR" | "US" | "GLOBAL";

export type AssetClass =
  | "treasury_br"
  | "treasury_us"
  | "bank_fixed_income"
  | "corporate_bond"
  | "fund"
  | "equity"
  | "etf"
  | "reit"
  | "crypto"
  | "stablecoin"
  | "tokenized";

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  treasury_br: "Tesouro Direto / títulos públicos BR",
  treasury_us: "US Treasuries",
  bank_fixed_income: "Renda fixa bancária (CDB, LCI, LCA, CD)",
  corporate_bond: "Crédito privado (debêntures, bonds)",
  fund: "Fundos e money market",
  equity: "Ações",
  etf: "ETFs",
  reit: "FIIs e REITs",
  crypto: "Criptoativos",
  stablecoin: "Stablecoins",
  tokenized: "Ativos tokenizados (RWA)",
};

export const ASSET_CLASS_SHORT: Record<AssetClass, string> = {
  treasury_br: "Tesouro BR",
  treasury_us: "Treasury EUA",
  bank_fixed_income: "Renda fixa bancária",
  corporate_bond: "Crédito privado",
  fund: "Fundos",
  equity: "Ações",
  etf: "ETFs",
  reit: "Imobiliário",
  crypto: "Cripto",
  stablecoin: "Stablecoins",
  tokenized: "Tokenizados",
};

export const ALL_ASSET_CLASSES = Object.keys(ASSET_CLASS_LABEL) as AssetClass[];

/** How an instrument's return accrues. Drives expected-return methodology. */
export type YieldSpec =
  | { type: "cdi_pct"; value: number } // 1.10 = 110% do CDI
  | { type: "selic_spread"; value: number } // Selic + spread (a.a.)
  | { type: "ipca_spread"; value: number } // IPCA + spread (a.a.)
  | { type: "prefixed"; value: number } // taxa nominal fixa (a.a.)
  | { type: "usd_fixed"; value: number } // taxa fixa em USD (a.a.)
  | { type: "tbill_spread"; value: number }; // T-bill 3M + spread

export type TaxRegime =
  | "br_regressive" // IR regressivo renda fixa 22,5% → 15%
  | "br_exempt_pf" // LCI/LCA/FII rendimentos — isento PF (regras sujeitas a mudança)
  | "br_equity_15" // ações/ETF BR — 15% sobre ganho
  | "br_crypto" // ganho de capital cripto
  | "us_ordinary" // juros tributados como renda ordinária (residente EUA)
  | "us_capital_gains"
  | "unknown";

export type CreditKind =
  | "sovereign"
  | "bank_insured" // FGC (BR) / FDIC (US) até o limite
  | "bank_uninsured"
  | "corporate"
  | "fund_portfolio"
  | "issuer_reserve" // stablecoin lastreada
  | "spv" // veículo de securitização / token
  | "none"; // ações, cripto: sem promessa de pagamento

export type Custody = "selic" | "b3" | "dtc" | "broker" | "fund_admin" | "exchange" | "self_custody" | "platform";

export interface AssetSpec {
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  market: Market;
  currency: Currency;
  issuer: string;
  sector: string;
  country: "BR" | "US" | "GLOBAL";
  description: string;
  /** quoted: price series; accrual: valued by contractual yield (estimated). */
  pricing: "quoted" | "accrual";
  yield?: YieldSpec;
  /** Dividend / distribution yield, informational. */
  distributionYield?: number;
  maturity?: string;
  /** Approx. modified duration in years (for mark-to-market risk). */
  duration?: number;
  /** Business days until cash is available after a redemption/sale request. */
  liquidityDays: number;
  /** Cannot be redeemed before maturity (no reliable secondary market). */
  lockedUntilMaturity?: boolean;
  minHorizonYears?: number;
  /** Annual fees: expense ratio, admin, custody, platform (fraction). */
  feesAnnual: number;
  feeNote?: string;
  tax: { regime: TaxRegime; note: string };
  credit: { kind: CreditKind; rating?: string; insuredLimit?: string; pdAnnual?: number; lgd?: number };
  counterparty: { custody: Custody; score: number; note: string };
  regulatory: {
    regulated: boolean;
    regulator?: string;
    score: number;
    eligibility?: ("qualified_investor" | "accredited_investor" | "us_person_restricted" | "br_resident_only" | "us_resident_only")[];
    note: string;
  };
  technology?: { smartContract: boolean; chain?: string; audited?: boolean; score: number; note: string };
  /** Number of underlying holdings; 1 = single issuer. */
  holdings: number;
  /** Where the price series comes from when live data is enabled. */
  liveProvider?: { provider: "coingecko"; id: string } | { provider: "alphavantage"; symbol: string } | { provider: "brapi"; symbol: string };
  /** Parameters for the deterministic demo series generator. */
  demo: { start: number; mu: number; sigma: number; jumpProb?: number; jumpSize?: number; peg?: number };
}

export type ObjectiveKind = "preservation" | "income" | "growth" | "high_growth";
export type HorizonKind = "lt1" | "1to3" | "3to5" | "gt5";
export type LossTolerance = "low" | "moderate" | "high" | "very_high";
export type LiquidityNeed = "daily" | "monthly" | "annual" | "none";
export type Experience = "none" | "basic" | "intermediate" | "advanced";

export interface ProfileAnswers {
  residenceCountry: "BR" | "US" | "OTHER";
  baseCurrency: Currency;
  amount: number;
  objective: ObjectiveKind;
  targetReturn: number; // fraction, e.g. 0.12
  horizon: HorizonKind;
  lossTolerance: LossTolerance;
  liquidityNeed: LiquidityNeed;
  markets: ("BR" | "US")[];
  allowedClasses: AssetClass[];
  excludedClasses: AssetClass[];
  experience: Experience;
  cryptoExperience: Experience;
  qualifiedInvestor?: boolean;
}

export type RiskLevel = 1 | 2 | 3 | 4;

export interface DerivedProfile {
  level: RiskLevel;
  label: string;
  maxRiskScore: number;
  maxDrawdown: number;
  maxCryptoWeight: number;
  maxTokenizedWeight: number;
  minLiquidWeight: number;
  horizonYears: number;
  explanation: string[];
  constraints: string[];
  methodologyVersion: string;
}

export type RiskCategory = "muito_baixo" | "baixo" | "moderado" | "alto" | "muito_alto";

export const RISK_CATEGORY_LABEL: Record<RiskCategory, string> = {
  muito_baixo: "Muito baixo",
  baixo: "Baixo",
  moderado: "Moderado",
  alto: "Alto",
  muito_alto: "Muito alto",
};

export type RiskComponentKey =
  | "market"
  | "credit"
  | "liquidity"
  | "fx"
  | "concentration"
  | "counterparty"
  | "regulatory"
  | "technology";

export const RISK_COMPONENT_LABEL: Record<RiskComponentKey, string> = {
  market: "Mercado",
  credit: "Crédito",
  liquidity: "Liquidez",
  fx: "Cambial",
  concentration: "Concentração",
  counterparty: "Contraparte",
  regulatory: "Regulatório",
  technology: "Tecnológico / smart contract",
};

export interface RiskComponent {
  key: RiskComponentKey;
  score: number | null; // null = não aplicável
  rationale: string;
}

export interface RiskAssessment {
  score: number; // 1..10
  category: RiskCategory;
  components: RiskComponent[];
  topContributors: string[];
  explanation: string;
  limitations: string[];
  methodologyVersion: string;
}

export type DataOrigin = "real" | "demo";

export interface PricePoint {
  date: string; // YYYY-MM-DD
  close: number;
}

export interface MacroSnapshot {
  cdi: number; // a.a. fraction
  selic: number;
  ipca12m: number;
  usdbrl: number;
  ust3m: number;
  ust10y: number;
  asOf: string;
  origin: Record<string, DataOrigin>;
}

export type Severity = "info" | "attention" | "critical";
export const SEVERITY_LABEL: Record<Severity, string> = { info: "Informativo", attention: "Atenção", critical: "Crítico" };
export const SEVERITY_RANK: Record<Severity, number> = { info: 0, attention: 1, critical: 2 };
