import type { AssetSpec } from "./types";

// Initial asset universe. Instrument characteristics (yields, fees, liquidity,
// regulatory notes) are illustrative and must be validated against the issuer's
// documentation before any real use. Price series for these assets are produced
// by the demo generator unless a live provider is configured and reachable.

const brRegressive = { regime: "br_regressive" as const, note: "IR regressivo: 22,5% (até 180 dias) a 15% (acima de 720 dias) sobre o rendimento; IOF nos primeiros 30 dias." };
const brEquity = { regime: "br_equity_15" as const, note: "15% sobre ganho de capital; isenção de vendas de ações até R$ 20 mil/mês (não se aplica a ETFs)." };
const usCg = { regime: "us_capital_gains" as const, note: "Para residentes nos EUA: ganho de capital (curto/longo prazo). Para não residentes: retenção sobre dividendos (em geral 30%, ou 15% com tratado) e tributação no país de residência." };
const cryptoTax = { regime: "br_crypto" as const, note: "Brasil: ganho de capital conforme legislação vigente para criptoativos; EUA: tratado como propriedade (capital gains). Confirme regras atuais com um contador." };

const b3Custody = { custody: "b3" as const, score: 2, note: "Custódia na B3 via corretora; segregação patrimonial." };
const usBroker = { custody: "dtc" as const, score: 3, note: "Custódia via corretora americana (DTC); proteção SIPC limitada, não cobre perdas de mercado." };

export const CATALOG: AssetSpec[] = [
  // ───────────── Brasil — títulos públicos ─────────────
  {
    id: "BR-TD-SELIC-2029", symbol: "Tesouro Selic 2029", name: "Tesouro Selic 2029 (LFT)", assetClass: "treasury_br", market: "BR", currency: "BRL",
    issuer: "Tesouro Nacional", sector: "Soberano", country: "BR", description: "Título pós-fixado atrelado à Selic, com liquidez diária pelo Tesouro Direto e baixa oscilação de preço.",
    pricing: "accrual", yield: { type: "selic_spread", value: 0.0008 }, maturity: "2029-03-01", duration: 0.1, liquidityDays: 1, feesAnnual: 0.002,
    feeNote: "Taxa de custódia B3 de 0,20% a.a. (isenção parcial para saldos menores).", tax: brRegressive,
    credit: { kind: "sovereign", rating: "BB (escala global)", pdAnnual: 0.0005, lgd: 0.4 }, counterparty: { custody: "selic", score: 1, note: "Registro no Selic/B3." },
    regulatory: { regulated: true, regulator: "Tesouro Nacional / B3", score: 1, eligibility: ["br_resident_only"], note: "Acesso via CPF e instituição habilitada." },
    holdings: 1, demo: { start: 15800, mu: 0.14, sigma: 0.003 },
  },
  {
    id: "BR-TD-IPCA-2035", symbol: "Tesouro IPCA+ 2035", name: "Tesouro IPCA+ 2035 (NTN-B Principal)", assetClass: "treasury_br", market: "BR", currency: "BRL",
    issuer: "Tesouro Nacional", sector: "Soberano", country: "BR", description: "Protege contra inflação (IPCA + taxa real). Marcação a mercado relevante antes do vencimento.",
    pricing: "accrual", yield: { type: "ipca_spread", value: 0.072 }, maturity: "2035-05-15", duration: 8.4, liquidityDays: 1, minHorizonYears: 5, feesAnnual: 0.002,
    feeNote: "Custódia B3 0,20% a.a.", tax: brRegressive, credit: { kind: "sovereign", rating: "BB (escala global)", pdAnnual: 0.0005, lgd: 0.4 },
    counterparty: { custody: "selic", score: 1, note: "Registro no Selic/B3." },
    regulatory: { regulated: true, regulator: "Tesouro Nacional / B3", score: 1, eligibility: ["br_resident_only"], note: "Recompra diária pelo Tesouro a preço de mercado." },
    holdings: 1, demo: { start: 2400, mu: 0.11, sigma: 0.11 },
  },
  {
    id: "BR-TD-PRE-2029", symbol: "Tesouro Prefixado 2029", name: "Tesouro Prefixado 2029 (LTN)", assetClass: "treasury_br", market: "BR", currency: "BRL",
    issuer: "Tesouro Nacional", sector: "Soberano", country: "BR", description: "Taxa nominal fixa até o vencimento. Ganha se os juros caírem, perde na marcação a mercado se subirem.",
    pricing: "accrual", yield: { type: "prefixed", value: 0.134 }, maturity: "2029-01-01", duration: 2.6, liquidityDays: 1, minHorizonYears: 2, feesAnnual: 0.002,
    tax: brRegressive, credit: { kind: "sovereign", rating: "BB (escala global)", pdAnnual: 0.0005, lgd: 0.4 }, counterparty: { custody: "selic", score: 1, note: "Registro no Selic/B3." },
    regulatory: { regulated: true, regulator: "Tesouro Nacional / B3", score: 1, eligibility: ["br_resident_only"], note: "Recompra diária a preço de mercado." },
    holdings: 1, demo: { start: 720, mu: 0.13, sigma: 0.05 },
  },
  // ───────────── Brasil — renda fixa bancária / crédito ─────────────
  {
    id: "BR-CDB-LIQ-100", symbol: "CDB 100% CDI", name: "CDB Liquidez Diária 100% CDI (banco grande)", assetClass: "bank_fixed_income", market: "BR", currency: "BRL",
    issuer: "Banco grande (exemplo)", sector: "Bancos", country: "BR", description: "CDB pós-fixado com resgate diário. Coberto pelo FGC até R$ 250 mil por CPF e instituição.",
    pricing: "accrual", yield: { type: "cdi_pct", value: 1.0 }, liquidityDays: 0, feesAnnual: 0, tax: brRegressive,
    credit: { kind: "bank_insured", rating: "AAA (br)", insuredLimit: "FGC: R$ 250 mil por CPF/instituição; teto global R$ 1 milhão a cada 4 anos", pdAnnual: 0.001, lgd: 0.5 },
    counterparty: { custody: "b3", score: 2, note: "Registro na B3; risco do banco emissor." },
    regulatory: { regulated: true, regulator: "Banco Central do Brasil", score: 1, eligibility: ["br_resident_only"], note: "Produto bancário regulado." },
    holdings: 1, demo: { start: 1000, mu: 0.14, sigma: 0.001 },
  },
  {
    id: "BR-CDB-MED-115", symbol: "CDB 115% CDI 2028", name: "CDB Banco Médio 115% CDI (venc. 2028)", assetClass: "bank_fixed_income", market: "BR", currency: "BRL",
    issuer: "Banco médio (exemplo)", sector: "Bancos", country: "BR", description: "Prêmio sobre o CDI em troca de risco de crédito maior e liquidez apenas no vencimento.",
    pricing: "accrual", yield: { type: "cdi_pct", value: 1.15 }, maturity: "2028-10-16", liquidityDays: 520, lockedUntilMaturity: true, minHorizonYears: 2, feesAnnual: 0,
    tax: brRegressive, credit: { kind: "bank_insured", rating: "A- (br)", insuredLimit: "FGC: R$ 250 mil por CPF/instituição", pdAnnual: 0.006, lgd: 0.5 },
    counterparty: { custody: "b3", score: 3, note: "Banco de médio porte; dependência de funding de varejo." },
    regulatory: { regulated: true, regulator: "Banco Central do Brasil", score: 1, eligibility: ["br_resident_only"], note: "Produto bancário regulado." },
    holdings: 1, demo: { start: 1000, mu: 0.16, sigma: 0.001 },
  },
  {
    id: "BR-LCI-95", symbol: "LCI 95% CDI", name: "LCI 95% CDI (carência 12 meses)", assetClass: "bank_fixed_income", market: "BR", currency: "BRL",
    issuer: "Banco grande (exemplo)", sector: "Bancos / Imobiliário", country: "BR", description: "Letra de Crédito Imobiliário isenta de IR para pessoa física, com carência mínima.",
    pricing: "accrual", yield: { type: "cdi_pct", value: 0.95 }, maturity: "2027-10-18", liquidityDays: 250, lockedUntilMaturity: true, minHorizonYears: 1, feesAnnual: 0,
    tax: { regime: "br_exempt_pf", note: "Isenta de IR para pessoa física (regras sujeitas a alteração legislativa)." },
    credit: { kind: "bank_insured", rating: "AAA (br)", insuredLimit: "FGC: R$ 250 mil por CPF/instituição", pdAnnual: 0.001, lgd: 0.5 },
    counterparty: { custody: "b3", score: 2, note: "Registro na B3." }, regulatory: { regulated: true, regulator: "Banco Central do Brasil", score: 1, eligibility: ["br_resident_only"], note: "Carência mínima regulatória." },
    holdings: 1, demo: { start: 1000, mu: 0.135, sigma: 0.001 },
  },
  {
    id: "BR-LCA-93", symbol: "LCA 93% CDI", name: "LCA 93% CDI (venc. 2027)", assetClass: "bank_fixed_income", market: "BR", currency: "BRL",
    issuer: "Banco agro (exemplo)", sector: "Bancos / Agro", country: "BR", description: "Letra de Crédito do Agronegócio isenta de IR para PF.",
    pricing: "accrual", yield: { type: "cdi_pct", value: 0.93 }, maturity: "2027-12-15", liquidityDays: 290, lockedUntilMaturity: true, minHorizonYears: 1, feesAnnual: 0,
    tax: { regime: "br_exempt_pf", note: "Isenta de IR para pessoa física (regras sujeitas a alteração legislativa)." },
    credit: { kind: "bank_insured", rating: "AA (br)", insuredLimit: "FGC: R$ 250 mil por CPF/instituição", pdAnnual: 0.002, lgd: 0.5 },
    counterparty: { custody: "b3", score: 2, note: "Registro na B3." }, regulatory: { regulated: true, regulator: "Banco Central do Brasil", score: 1, eligibility: ["br_resident_only"], note: "Produto bancário regulado." },
    holdings: 1, demo: { start: 1000, mu: 0.13, sigma: 0.001 },
  },
  {
    id: "BR-DEB-IPCA-INFRA", symbol: "Debênture Infra IPCA+7,8%", name: "Debênture incentivada de infraestrutura IPCA+7,8% (2032)", assetClass: "corporate_bond", market: "BR", currency: "BRL",
    issuer: "Concessionária de energia (exemplo)", sector: "Energia", country: "BR", description: "Crédito privado sem garantia do FGC. Isenta de IR para PF (Lei 12.431). Liquidez secundária limitada.",
    pricing: "accrual", yield: { type: "ipca_spread", value: 0.078 }, maturity: "2032-09-15", duration: 4.8, liquidityDays: 10, minHorizonYears: 4, feesAnnual: 0,
    tax: { regime: "br_exempt_pf", note: "Debênture incentivada: isenta de IR para PF." }, credit: { kind: "corporate", rating: "AA (br)", pdAnnual: 0.008, lgd: 0.6 },
    counterparty: { custody: "b3", score: 3, note: "Mercado secundário via corretora; spread de compra/venda relevante." },
    regulatory: { regulated: true, regulator: "CVM", score: 2, eligibility: ["br_resident_only"], note: "Oferta pública registrada na CVM." },
    holdings: 1, demo: { start: 1000, mu: 0.12, sigma: 0.06 },
  },
  {
    id: "BR-FUNDO-DI", symbol: "Fundo DI", name: "Fundo DI referenciado (taxa 0,3%)", assetClass: "fund", market: "BR", currency: "BRL",
    issuer: "Gestora (exemplo)", sector: "Fundos", country: "BR", description: "Fundo que replica o CDI com títulos públicos e compromissadas. Come-cotas semestral.",
    pricing: "accrual", yield: { type: "cdi_pct", value: 0.97 }, liquidityDays: 0, feesAnnual: 0.003, feeNote: "Taxa de administração 0,30% a.a. (já refletida no % do CDI líquido estimado).",
    tax: { regime: "br_regressive", note: "IR regressivo + come-cotas semestral (15%/20%)." }, credit: { kind: "fund_portfolio", rating: "Carteira soberana", pdAnnual: 0.0005, lgd: 0.4 },
    counterparty: { custody: "fund_admin", score: 2, note: "Administrador e custodiante fiduciários." }, regulatory: { regulated: true, regulator: "CVM", score: 1, note: "Fundo regulado pela Resolução CVM 175." },
    holdings: 50, demo: { start: 250, mu: 0.137, sigma: 0.002 },
  },
  // ───────────── Brasil — renda variável ─────────────
  {
    id: "BR-BOVA11", symbol: "BOVA11", name: "iShares Ibovespa (BOVA11)", assetClass: "etf", market: "BR", currency: "BRL", issuer: "BlackRock", sector: "Índice amplo", country: "BR",
    description: "ETF que replica o Ibovespa. Diversificado, mas concentrado em commodities e bancos.", pricing: "quoted", distributionYield: 0, liquidityDays: 2, feesAnnual: 0.001,
    tax: { regime: "br_equity_15", note: "15% sobre ganho; sem isenção de R$ 20 mil para ETFs." }, credit: { kind: "none" }, counterparty: b3Custody,
    regulatory: { regulated: true, regulator: "CVM / B3", score: 1, note: "ETF listado." }, holdings: 86, liveProvider: { provider: "brapi", symbol: "BOVA11" }, demo: { start: 128, mu: 0.11, sigma: 0.22 },
  },
  {
    id: "BR-IVVB11", symbol: "IVVB11", name: "iShares S&P 500 em reais (IVVB11)", assetClass: "etf", market: "BR", currency: "BRL", issuer: "BlackRock", sector: "Índice amplo (EUA)", country: "US",
    description: "Exposição ao S&P 500 negociada na B3, sem hedge cambial (sobe quando o dólar sobe).", pricing: "quoted", liquidityDays: 2, feesAnnual: 0.0023,
    tax: { regime: "br_equity_15", note: "15% sobre ganho; sem isenção para ETFs." }, credit: { kind: "none" }, counterparty: b3Custody,
    regulatory: { regulated: true, regulator: "CVM / B3", score: 1, note: "ETF listado." }, holdings: 503, liveProvider: { provider: "brapi", symbol: "IVVB11" }, demo: { start: 330, mu: 0.12, sigma: 0.19 },
  },
  {
    id: "BR-PETR4", symbol: "PETR4", name: "Petrobras PN (PETR4)", assetClass: "equity", market: "BR", currency: "BRL", issuer: "Petrobras", sector: "Petróleo e gás", country: "BR",
    description: "Alta geração de caixa e dividendos, com risco de interferência governamental e de preço do petróleo.", pricing: "quoted", distributionYield: 0.11, liquidityDays: 2, feesAnnual: 0,
    tax: brEquity, credit: { kind: "none" }, counterparty: b3Custody, regulatory: { regulated: true, regulator: "CVM / B3", score: 2, note: "Estatal: risco de governança." }, holdings: 1,
    liveProvider: { provider: "brapi", symbol: "PETR4" }, demo: { start: 37, mu: 0.12, sigma: 0.33, jumpProb: 0.004, jumpSize: -0.08 },
  },
  {
    id: "BR-ITUB4", symbol: "ITUB4", name: "Itaú Unibanco PN (ITUB4)", assetClass: "equity", market: "BR", currency: "BRL", issuer: "Itaú Unibanco", sector: "Bancos", country: "BR",
    description: "Maior banco privado do país, rentabilidade consistente.", pricing: "quoted", distributionYield: 0.07, liquidityDays: 2, feesAnnual: 0, tax: brEquity, credit: { kind: "none" },
    counterparty: b3Custody, regulatory: { regulated: true, regulator: "CVM / B3", score: 1, note: "Companhia listada no Nível 1." }, holdings: 1, liveProvider: { provider: "brapi", symbol: "ITUB4" },
    demo: { start: 33, mu: 0.13, sigma: 0.25 },
  },
  {
    id: "BR-WEGE3", symbol: "WEGE3", name: "WEG ON (WEGE3)", assetClass: "equity", market: "BR", currency: "BRL", issuer: "WEG", sector: "Bens de capital", country: "BR",
    description: "Indústria com receita global e histórico de crescimento; múltiplos elevados.", pricing: "quoted", distributionYield: 0.015, liquidityDays: 2, feesAnnual: 0, tax: brEquity,
    credit: { kind: "none" }, counterparty: b3Custody, regulatory: { regulated: true, regulator: "CVM / B3", score: 1, note: "Novo Mercado." }, holdings: 1,
    liveProvider: { provider: "brapi", symbol: "WEGE3" }, demo: { start: 40, mu: 0.12, sigma: 0.28 },
  },
  {
    id: "BR-VALE3", symbol: "VALE3", name: "Vale ON (VALE3)", assetClass: "equity", market: "BR", currency: "BRL", issuer: "Vale", sector: "Mineração", country: "BR",
    description: "Exportadora de minério de ferro; ciclo de commodities e China.", pricing: "quoted", distributionYield: 0.08, liquidityDays: 2, feesAnnual: 0, tax: brEquity, credit: { kind: "none" },
    counterparty: b3Custody, regulatory: { regulated: true, regulator: "CVM / B3", score: 2, note: "Passivos ambientais relevantes." }, holdings: 1, liveProvider: { provider: "brapi", symbol: "VALE3" },
    demo: { start: 60, mu: 0.1, sigma: 0.3 },
  },
  {
    id: "BR-HGLG11", symbol: "HGLG11", name: "CSHG Logística (HGLG11)", assetClass: "reit", market: "BR", currency: "BRL", issuer: "Pátria / CSHG", sector: "Imobiliário — logística", country: "BR",
    description: "FII de galpões logísticos, distribuição mensal.", pricing: "quoted", distributionYield: 0.088, liquidityDays: 2, feesAnnual: 0.006,
    tax: { regime: "br_exempt_pf", note: "Rendimentos isentos para PF (condições legais); 20% sobre ganho de capital." }, credit: { kind: "none" }, counterparty: b3Custody,
    regulatory: { regulated: true, regulator: "CVM / B3", score: 2, note: "FII listado." }, holdings: 20, liveProvider: { provider: "brapi", symbol: "HGLG11" }, demo: { start: 160, mu: 0.1, sigma: 0.14 },
  },
  {
    id: "BR-KNCR11", symbol: "KNCR11", name: "Kinea Rendimentos Imobiliários (KNCR11)", assetClass: "reit", market: "BR", currency: "BRL", issuer: "Kinea", sector: "Imobiliário — CRI (papel)", country: "BR",
    description: "FII de recebíveis imobiliários (CRIs) atrelados ao CDI.", pricing: "quoted", distributionYield: 0.13, liquidityDays: 2, feesAnnual: 0.01,
    tax: { regime: "br_exempt_pf", note: "Rendimentos isentos para PF (condições legais); 20% sobre ganho de capital." }, credit: { kind: "fund_portfolio", rating: "Carteira de CRIs high grade", pdAnnual: 0.01, lgd: 0.5 },
    counterparty: b3Custody, regulatory: { regulated: true, regulator: "CVM / B3", score: 2, note: "FII listado." }, holdings: 60, liveProvider: { provider: "brapi", symbol: "KNCR11" }, demo: { start: 102, mu: 0.135, sigma: 0.05 },
  },
  // ───────────── Brasil — tokenizados ─────────────
  {
    id: "BR-RWA-RECEB", symbol: "TKN-RECEB", name: "Token de recebíveis comerciais (CCB tokenizada)", assetClass: "tokenized", market: "BR", currency: "BRL",
    issuer: "Plataforma de tokenização (exemplo)", sector: "Crédito estruturado", country: "BR", description: "Fração tokenizada de carteira de recebíveis/CCBs, com remuneração prefixada e prazo de 12 meses. Sem FGC.",
    pricing: "accrual", yield: { type: "prefixed", value: 0.185 }, maturity: "2027-10-01", liquidityDays: 250, lockedUntilMaturity: true, minHorizonYears: 1, feesAnnual: 0.01,
    feeNote: "Taxa de plataforma estimada 1% a.a.", tax: { regime: "br_regressive", note: "Tributação depende da estrutura jurídica (CCB / valor mobiliário). Verifique o prospecto." },
    credit: { kind: "spv", rating: "Sem rating", pdAnnual: 0.04, lgd: 0.6 }, counterparty: { custody: "platform", score: 7, note: "Dependência da plataforma, do cedente e do agente de cobrança." },
    regulatory: { regulated: true, regulator: "CVM (Resolução 88 — crowdfunding) ou sandbox", score: 6, eligibility: ["br_resident_only"], note: "Limites de investimento por investidor podem se aplicar." },
    technology: { smartContract: true, chain: "Rede permissionada / EVM", audited: false, score: 5, note: "Registro em blockchain; direitos dependem do contrato off-chain." },
    holdings: 40, demo: { start: 1000, mu: 0.17, sigma: 0.001 },
  },
  // ───────────── EUA — renda fixa ─────────────
  {
    id: "US-TBILL-3M", symbol: "T-Bill 3M", name: "US Treasury Bill 3 meses", assetClass: "treasury_us", market: "US", currency: "USD", issuer: "U.S. Treasury", sector: "Soberano", country: "US",
    description: "Título de curtíssimo prazo do governo americano; referência de 'taxa livre de risco' em dólar.", pricing: "accrual", yield: { type: "tbill_spread", value: 0 }, duration: 0.25, liquidityDays: 1,
    feesAnnual: 0, tax: { regime: "us_ordinary", note: "Juros isentos de imposto estadual nos EUA; não residentes em geral isentos de retenção (portfolio interest)." },
    credit: { kind: "sovereign", rating: "AA+", pdAnnual: 0.0001, lgd: 0.1 }, counterparty: usBroker, regulatory: { regulated: true, regulator: "U.S. Treasury / SEC (corretora)", score: 1, note: "Acesso via TreasuryDirect (residentes) ou corretora." },
    holdings: 1, demo: { start: 100, mu: 0.04, sigma: 0.002 },
  },
  {
    id: "US-TNOTE-5Y", symbol: "T-Note 5Y", name: "US Treasury Note 5 anos", assetClass: "treasury_us", market: "US", currency: "USD", issuer: "U.S. Treasury", sector: "Soberano", country: "US",
    description: "Título de média duração; oscila com os juros americanos.", pricing: "quoted", duration: 4.5, liquidityDays: 1, feesAnnual: 0,
    tax: { regime: "us_ordinary", note: "Cupons tributados como renda (residentes); isento de imposto estadual." }, credit: { kind: "sovereign", rating: "AA+", pdAnnual: 0.0001, lgd: 0.1 },
    counterparty: usBroker, regulatory: { regulated: true, regulator: "U.S. Treasury", score: 1, note: "Mercado secundário muito líquido." }, holdings: 1, demo: { start: 98, mu: 0.042, sigma: 0.05 },
  },
  {
    id: "US-TLT", symbol: "TLT", name: "iShares 20+ Year Treasury Bond ETF (TLT)", assetClass: "etf", market: "US", currency: "USD", issuer: "BlackRock", sector: "Treasuries longos", country: "US",
    description: "Treasuries acima de 20 anos: sem risco de crédito relevante, mas alta sensibilidade a juros.", pricing: "quoted", distributionYield: 0.043, duration: 16.5, liquidityDays: 2, feesAnnual: 0.0015,
    tax: usCg, credit: { kind: "fund_portfolio", rating: "AA+", pdAnnual: 0.0001, lgd: 0.1 }, counterparty: usBroker, regulatory: { regulated: true, regulator: "SEC", score: 1, note: "ETF registrado na SEC." },
    holdings: 40, liveProvider: { provider: "alphavantage", symbol: "TLT" }, demo: { start: 90, mu: 0.04, sigma: 0.16 },
  },
  {
    id: "US-CD-12M", symbol: "Bank CD 12M", name: "Certificate of Deposit 12 meses (banco EUA)", assetClass: "bank_fixed_income", market: "US", currency: "USD", issuer: "Banco americano (exemplo)", sector: "Bancos", country: "US",
    description: "Depósito a prazo com taxa fixa; seguro FDIC até US$ 250 mil.", pricing: "accrual", yield: { type: "usd_fixed", value: 0.041 }, maturity: "2027-10-18", liquidityDays: 250,
    lockedUntilMaturity: true, minHorizonYears: 1, feesAnnual: 0, tax: { regime: "us_ordinary", note: "Juros tributados como renda ordinária (residentes)." },
    credit: { kind: "bank_insured", rating: "A", insuredLimit: "FDIC: US$ 250 mil por depositante/banco/categoria", pdAnnual: 0.001, lgd: 0.3 },
    counterparty: { custody: "broker", score: 2, note: "Banco emissor; brokered CDs dependem da corretora." },
    regulatory: { regulated: true, regulator: "FDIC / OCC", score: 2, eligibility: ["us_resident_only"], note: "Abertura de conta normalmente exige residência/SSN; brokered CDs podem ser acessíveis via corretora." },
    holdings: 1, demo: { start: 100, mu: 0.041, sigma: 0.001 },
  },
  {
    id: "US-MMF-GOV", symbol: "Gov MMF", name: "Government Money Market Fund", assetClass: "fund", market: "US", currency: "USD", issuer: "Gestora (exemplo)", sector: "Money market", country: "US",
    description: "Fundo de mercado monetário de títulos públicos; busca NAV estável de US$ 1.", pricing: "accrual", yield: { type: "tbill_spread", value: -0.0012 }, liquidityDays: 1, feesAnnual: 0.0012,
    tax: { regime: "us_ordinary", note: "Distribuições tributadas como dividendos ordinários." }, credit: { kind: "fund_portfolio", rating: "AAAm", pdAnnual: 0.0002, lgd: 0.1 },
    counterparty: { custody: "fund_admin", score: 2, note: "Fundo registrado (Rule 2a-7)." }, regulatory: { regulated: true, regulator: "SEC (Rule 2a-7)", score: 1, note: "NAV estável não é garantido." },
    holdings: 200, demo: { start: 1, mu: 0.039, sigma: 0.0005 },
  },
  {
    id: "US-LQD", symbol: "LQD", name: "iShares iBoxx $ Investment Grade Corporate Bond (LQD)", assetClass: "corporate_bond", market: "US", currency: "USD", issuer: "BlackRock", sector: "Crédito IG", country: "US",
    description: "Carteira diversificada de bonds corporativos grau de investimento.", pricing: "quoted", distributionYield: 0.047, duration: 8.3, liquidityDays: 2, feesAnnual: 0.0014,
    tax: usCg, credit: { kind: "fund_portfolio", rating: "A-/BBB+ (médio)", pdAnnual: 0.002, lgd: 0.6 }, counterparty: usBroker, regulatory: { regulated: true, regulator: "SEC", score: 1, note: "ETF registrado." },
    holdings: 2800, liveProvider: { provider: "alphavantage", symbol: "LQD" }, demo: { start: 108, mu: 0.05, sigma: 0.09 },
  },
  // ───────────── EUA — renda variável ─────────────
  {
    id: "US-VOO", symbol: "VOO", name: "Vanguard S&P 500 ETF (VOO)", assetClass: "etf", market: "US", currency: "USD", issuer: "Vanguard", sector: "Índice amplo", country: "US",
    description: "As 500 maiores empresas americanas; custo muito baixo.", pricing: "quoted", distributionYield: 0.013, liquidityDays: 2, feesAnnual: 0.0003, tax: usCg, credit: { kind: "none" },
    counterparty: usBroker, regulatory: { regulated: true, regulator: "SEC", score: 1, note: "ETF registrado; não residentes podem ter retenção sobre dividendos." }, holdings: 503,
    liveProvider: { provider: "alphavantage", symbol: "VOO" }, demo: { start: 520, mu: 0.1, sigma: 0.17 },
  },
  {
    id: "US-QQQ", symbol: "QQQ", name: "Invesco QQQ Trust (Nasdaq-100)", assetClass: "etf", market: "US", currency: "USD", issuer: "Invesco", sector: "Tecnologia", country: "US",
    description: "Nasdaq-100, concentrado em grandes empresas de tecnologia.", pricing: "quoted", distributionYield: 0.006, liquidityDays: 2, feesAnnual: 0.002, tax: usCg, credit: { kind: "none" },
    counterparty: usBroker, regulatory: { regulated: true, regulator: "SEC", score: 1, note: "ETF registrado." }, holdings: 101, liveProvider: { provider: "alphavantage", symbol: "QQQ" },
    demo: { start: 480, mu: 0.12, sigma: 0.23 },
  },
  {
    id: "US-MSFT", symbol: "MSFT", name: "Microsoft Corp. (MSFT)", assetClass: "equity", market: "US", currency: "USD", issuer: "Microsoft", sector: "Tecnologia", country: "US",
    description: "Software, nuvem e IA; balanço muito sólido.", pricing: "quoted", distributionYield: 0.007, liquidityDays: 2, feesAnnual: 0, tax: usCg, credit: { kind: "none" }, counterparty: usBroker,
    regulatory: { regulated: true, regulator: "SEC", score: 1, note: "Listada na Nasdaq." }, holdings: 1, liveProvider: { provider: "alphavantage", symbol: "MSFT" }, demo: { start: 410, mu: 0.12, sigma: 0.26 },
  },
  {
    id: "US-NVDA", symbol: "NVDA", name: "NVIDIA Corp. (NVDA)", assetClass: "equity", market: "US", currency: "USD", issuer: "NVIDIA", sector: "Semicondutores", country: "US",
    description: "Líder em GPUs para IA; crescimento muito alto e volatilidade elevada.", pricing: "quoted", distributionYield: 0.0003, liquidityDays: 2, feesAnnual: 0, tax: usCg, credit: { kind: "none" },
    counterparty: usBroker, regulatory: { regulated: true, regulator: "SEC", score: 2, note: "Risco de restrições de exportação." }, holdings: 1, liveProvider: { provider: "alphavantage", symbol: "NVDA" },
    demo: { start: 110, mu: 0.15, sigma: 0.5, jumpProb: 0.006, jumpSize: -0.09 },
  },
  {
    id: "US-VNQ", symbol: "VNQ", name: "Vanguard Real Estate ETF (VNQ)", assetClass: "reit", market: "US", currency: "USD", issuer: "Vanguard", sector: "Imobiliário — diversificado", country: "US",
    description: "Carteira diversificada de REITs americanos.", pricing: "quoted", distributionYield: 0.039, liquidityDays: 2, feesAnnual: 0.0013, tax: usCg, credit: { kind: "none" }, counterparty: usBroker,
    regulatory: { regulated: true, regulator: "SEC", score: 1, note: "ETF registrado." }, holdings: 155, liveProvider: { provider: "alphavantage", symbol: "VNQ" }, demo: { start: 88, mu: 0.08, sigma: 0.21 },
  },
  {
    id: "US-O", symbol: "O", name: "Realty Income Corp. (O)", assetClass: "reit", market: "US", currency: "USD", issuer: "Realty Income", sector: "Imobiliário — varejo net lease", country: "US",
    description: "REIT de locação net lease com dividendos mensais.", pricing: "quoted", distributionYield: 0.056, liquidityDays: 2, feesAnnual: 0, tax: usCg, credit: { kind: "none" }, counterparty: usBroker,
    regulatory: { regulated: true, regulator: "SEC", score: 1, note: "Listada na NYSE." }, holdings: 1, liveProvider: { provider: "alphavantage", symbol: "O" }, demo: { start: 56, mu: 0.07, sigma: 0.2 },
  },
  // ───────────── EUA / global — tokenizados ─────────────
  {
    id: "US-RWA-TBILL", symbol: "TKN-USTB", name: "Fundo tokenizado de T-Bills (exemplo)", assetClass: "tokenized", market: "US", currency: "USD", issuer: "Gestora + plataforma (exemplo)", sector: "Treasuries tokenizados", country: "US",
    description: "Cotas de fundo de T-Bills representadas por tokens em blockchain pública. Acesso normalmente restrito a investidores qualificados e não-US persons, conforme o produto.",
    pricing: "accrual", yield: { type: "tbill_spread", value: -0.003 }, liquidityDays: 1, feesAnnual: 0.003, feeNote: "Taxa de gestão ~0,30% a.a.", tax: { regime: "unknown", note: "Tratamento fiscal depende da estrutura do fundo e da jurisdição do investidor." },
    credit: { kind: "fund_portfolio", rating: "Lastro em T-Bills", pdAnnual: 0.0003, lgd: 0.1 }, counterparty: { custody: "platform", score: 5, note: "Gestor, custodiante, agente de transferência e emissor do token." },
    regulatory: { regulated: true, regulator: "SEC / regulador do domicílio do fundo", score: 5, eligibility: ["qualified_investor"], note: "Mínimos elevados e requisitos de KYC/elegibilidade." },
    technology: { smartContract: true, chain: "Ethereum", audited: true, score: 4, note: "Contrato auditado; risco residual de chave/whitelist e da rede." },
    holdings: 30, demo: { start: 1, mu: 0.037, sigma: 0.0005 },
  },
  {
    id: "GL-RWA-GOLD", symbol: "TKN-GOLD", name: "Ouro tokenizado (1 token ≈ 1 oz troy)", assetClass: "tokenized", market: "GLOBAL", currency: "USD", issuer: "Emissor de token de ouro (exemplo)", sector: "Commodities", country: "GLOBAL",
    description: "Token lastreado em ouro físico custodiado em cofre; preço acompanha o ouro.", pricing: "quoted", liquidityDays: 1, feesAnnual: 0.002, tax: cryptoTax,
    credit: { kind: "issuer_reserve", rating: "Sem rating", pdAnnual: 0.003, lgd: 0.5 }, counterparty: { custody: "exchange", score: 5, note: "Depende do emissor e do custodiante do ouro físico." },
    regulatory: { regulated: false, regulator: "Varia por jurisdição", score: 6, note: "Regulação de ativos tokenizados ainda em evolução." },
    technology: { smartContract: true, chain: "Ethereum", audited: true, score: 5, note: "Risco de smart contract e de custódia de chaves." },
    holdings: 1, demo: { start: 2400, mu: 0.05, sigma: 0.15 },
  },
  // ───────────── Cripto e stablecoins ─────────────
  {
    id: "CR-BTC", symbol: "BTC", name: "Bitcoin", assetClass: "crypto", market: "GLOBAL", currency: "USD", issuer: "Rede Bitcoin (sem emissor)", sector: "Cripto — reserva de valor", country: "GLOBAL",
    description: "Maior criptoativo por capitalização; oferta limitada; volatilidade muito alta e quedas históricas acima de 70%.", pricing: "quoted", liquidityDays: 0, feesAnnual: 0.003,
    feeNote: "Spread/corretagem e custódia estimados em 0,3% a.a. (ETFs spot cobram ~0,2–0,25%).", tax: cryptoTax, credit: { kind: "none" },
    counterparty: { custody: "exchange", score: 6, note: "Risco de exchange/custodiante; autocustódia transfere o risco para o investidor." },
    regulatory: { regulated: false, regulator: "BCB (Lei 14.478) / SEC-CFTC", score: 5, note: "Prestadores regulados, mas o ativo não tem emissor nem garantias." },
    technology: { smartContract: false, chain: "Bitcoin", score: 4, note: "Protocolo maduro; riscos de custódia de chaves." },
    holdings: 1, liveProvider: { provider: "coingecko", id: "bitcoin" }, demo: { start: 60000, mu: 0.15, sigma: 0.55, jumpProb: 0.01, jumpSize: -0.1 },
  },
  {
    id: "CR-ETH", symbol: "ETH", name: "Ether (Ethereum)", assetClass: "crypto", market: "GLOBAL", currency: "USD", issuer: "Rede Ethereum (sem emissor)", sector: "Cripto — plataforma", country: "GLOBAL",
    description: "Plataforma de contratos inteligentes; base de DeFi e de muitos tokens de RWA.", pricing: "quoted", liquidityDays: 0, feesAnnual: 0.004, tax: cryptoTax, credit: { kind: "none" },
    counterparty: { custody: "exchange", score: 6, note: "Risco de exchange/custodiante." }, regulatory: { regulated: false, regulator: "BCB / SEC-CFTC", score: 5, note: "Status regulatório em evolução." },
    technology: { smartContract: true, chain: "Ethereum", score: 6, note: "Complexidade de protocolo e de ecossistema." }, holdings: 1, liveProvider: { provider: "coingecko", id: "ethereum" },
    demo: { start: 3000, mu: 0.15, sigma: 0.7, jumpProb: 0.012, jumpSize: -0.12 },
  },
  {
    id: "CR-SOL", symbol: "SOL", name: "Solana", assetClass: "crypto", market: "GLOBAL", currency: "USD", issuer: "Rede Solana", sector: "Cripto — plataforma", country: "GLOBAL",
    description: "Blockchain de alta performance; histórico de interrupções de rede e volatilidade extrema.", pricing: "quoted", liquidityDays: 0, feesAnnual: 0.005, tax: cryptoTax, credit: { kind: "none" },
    counterparty: { custody: "exchange", score: 6, note: "Risco de exchange/custodiante." }, regulatory: { regulated: false, regulator: "BCB / SEC-CFTC", score: 6, note: "Status regulatório em evolução." },
    technology: { smartContract: true, chain: "Solana", score: 7, note: "Interrupções de rede no histórico." }, holdings: 1, liveProvider: { provider: "coingecko", id: "solana" },
    demo: { start: 140, mu: 0.15, sigma: 0.9, jumpProb: 0.015, jumpSize: -0.14 },
  },
  {
    id: "CR-USDC", symbol: "USDC", name: "USD Coin (stablecoin)", assetClass: "stablecoin", market: "GLOBAL", currency: "USD", issuer: "Circle", sector: "Stablecoin lastreada em USD", country: "US",
    description: "Stablecoin lastreada em caixa e T-Bills, com atestados periódicos. Não rende juros por si só; preserva valor em dólar se a paridade se mantiver.", pricing: "quoted", liquidityDays: 0, feesAnnual: 0.001,
    tax: cryptoTax, credit: { kind: "issuer_reserve", rating: "Reservas atestadas", pdAnnual: 0.004, lgd: 0.1 }, counterparty: { custody: "exchange", score: 5, note: "Emissor + exchange/carteira." },
    regulatory: { regulated: true, regulator: "Regulação de stablecoins (EUA) / BCB", score: 4, note: "Arcabouço regulatório recente." },
    technology: { smartContract: true, chain: "Multichain", audited: true, score: 5, note: "Risco de bridge/contrato e de bloqueio pelo emissor." },
    holdings: 1, liveProvider: { provider: "coingecko", id: "usd-coin" }, demo: { start: 1, mu: 0, sigma: 0.004, peg: 1 },
  },
  {
    id: "CR-USDT", symbol: "USDT", name: "Tether (stablecoin)", assetClass: "stablecoin", market: "GLOBAL", currency: "USD", issuer: "Tether", sector: "Stablecoin lastreada em USD", country: "GLOBAL",
    description: "Maior stablecoin por volume; transparência de reservas historicamente questionada.", pricing: "quoted", liquidityDays: 0, feesAnnual: 0.001, tax: cryptoTax,
    credit: { kind: "issuer_reserve", rating: "Reservas com atestado limitado", pdAnnual: 0.01, lgd: 0.2 }, counterparty: { custody: "exchange", score: 6, note: "Emissor offshore + exchange." },
    regulatory: { regulated: false, regulator: "Emissor offshore", score: 7, note: "Restrições crescentes em algumas jurisdições." },
    technology: { smartContract: true, chain: "Multichain", audited: false, score: 5, note: "Risco de contrato e de congelamento." },
    holdings: 1, liveProvider: { provider: "coingecko", id: "tether" }, demo: { start: 1, mu: 0, sigma: 0.005, peg: 1 },
  },
];

export const CATALOG_BY_ID = new Map(CATALOG.map((a) => [a.id, a]));

export function getSpec(id: string): AssetSpec {
  const spec = CATALOG_BY_ID.get(id);
  if (!spec) throw new Error(`Ativo desconhecido: ${id}`);
  return spec;
}
