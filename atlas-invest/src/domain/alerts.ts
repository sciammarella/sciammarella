// Monitoring alert rules — alerts-v1.0. Pure: given the current and previous
// state of a portfolio, return alert candidates. Deduplication/cooldown is also
// pure (see dedupe) so it can be tested without a database.

import type { DataStatus } from "./calendar";
import { DATA_STATUS_LABEL } from "./calendar";
import type { AssetClass, Currency, MacroSnapshot, RiskCategory, Severity } from "./types";
import { RISK_CATEGORY_LABEL, SEVERITY_RANK } from "./types";

export const ALERT_RULES_VERSION = "alerts-v1.0";

export interface Thresholds {
  priceMoveEquity: number; // fraction, e.g. 0.05
  priceMoveCrypto: number;
  priceMoveFixed: number;
  stablecoinDepeg: number;
  driftPp: number; // absolute weight deviation, e.g. 0.05
  maxSingleWeight: number;
  fxMove: number;
  rateMovePp: number; // e.g. 0.0025 = 25 bp
  volRatio: number;
  minWeightForPriceAlert: number;
  cooldownHours: number;
  minSeverity: Severity;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  priceMoveEquity: 0.05,
  priceMoveCrypto: 0.1,
  priceMoveFixed: 0.015,
  stablecoinDepeg: 0.005,
  driftPp: 0.05,
  maxSingleWeight: 0.25,
  fxMove: 0.03,
  rateMovePp: 0.0025,
  volRatio: 1.6,
  minWeightForPriceAlert: 0.02,
  cooldownHours: 24,
  minSeverity: "info",
};

export interface MonitorAssetState {
  assetId: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  weight: number;
  value: number;
  targetWeight: number | null;
  price: number | null;
  priceDate: string | null;
  prevPrice: number | null;
  prevPriceDate: string | null;
  prevSource: "last_run" | "previous_close" | null;
  status: DataStatus;
  origin: "real" | "demo" | null;
  sourceName: string | null;
  riskScore: number;
  prevRiskScore: number | null;
  riskCategory: RiskCategory;
  prevRiskCategory: RiskCategory | null;
  recentVol: number | null;
  longVol: number | null;
  peg?: number;
}

export interface MonitorEvent {
  id: string;
  assetId: string | null;
  type: string; // credit | regulatory | liquidity | counterparty | fundamentals | crypto
  severity: Severity;
  title: string;
  description: string;
  occurredAt: string;
  isDemo: boolean;
  sourceName: string;
}

export interface MonitorContext {
  portfolioId: string;
  portfolioName: string;
  baseCurrency: Currency;
  totalValue: number;
  profile: { label: string; maxRiskScore: number; maxDrawdown: number; maxCryptoWeight: number; objective: string };
  portfolioRisk: number;
  prevPortfolioRisk: number | null;
  peakValue: number | null;
  macro: { current: MacroSnapshot; previous: MacroSnapshot | null };
  events: MonitorEvent[];
  fxExposure: number;
  fixedIncomeWeight: number;
  assets: MonitorAssetState[];
  analyzedAt: string;
}

export interface Evidence {
  label: string;
  value: string;
  source: string;
  asOf: string | null;
  isDemo?: boolean;
}

export interface AlertCandidate {
  rule: string;
  fingerprint: string;
  severity: Severity;
  title: string;
  whatChanged: string;
  whyMatters: string;
  affected: { assets: string[]; objectives: string[] };
  impact: { portfolioPct: number | null; amount: number | null; description: string };
  suggestedAction: string;
  evidence: Evidence[];
}

const pct = (n: number, d = 1) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(d)}%`;
const pp = (n: number, d = 2) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(d)} p.p.`;
const money = (n: number, c: Currency) => new Intl.NumberFormat(c === "BRL" ? "pt-BR" : "en-US", { style: "currency", currency: c, maximumFractionDigits: 0 }).format(n);

function priceThreshold(cls: AssetClass, t: Thresholds): number {
  if (cls === "crypto") return t.priceMoveCrypto;
  if (["treasury_br", "treasury_us", "bank_fixed_income", "fund"].includes(cls)) return t.priceMoveFixed;
  if (cls === "corporate_bond") return t.priceMoveFixed * 2;
  return t.priceMoveEquity;
}

export function evaluateRules(ctx: MonitorContext, t: Thresholds = DEFAULT_THRESHOLDS): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  const pid = ctx.portfolioId;
  const objective = ctx.profile.objective;

  for (const a of ctx.assets) {
    const ev = (label: string, value: string, asOf: string | null = a.priceDate): Evidence => ({ label, value, source: a.sourceName ?? "—", asOf, isDemo: a.origin === "demo" });

    // Data availability — never infer price conclusions from missing data.
    if (a.status === "stale" || a.status === "source_unavailable" || a.status === "no_data") {
      if (a.weight >= t.minWeightForPriceAlert) {
        out.push({
          rule: "data_quality", fingerprint: `data_quality:${pid}:${a.assetId}:${a.status}`, severity: "info",
          title: `Dados de ${a.symbol}: ${DATA_STATUS_LABEL[a.status].toLowerCase()}`,
          whatChanged: `O monitor não obteve cotação atualizada para ${a.name} (${DATA_STATUS_LABEL[a.status].toLowerCase()}; último preço em ${a.priceDate ?? "—"}).`,
          whyMatters: "Sem dados atualizados não é possível avaliar variação de preço e risco deste ativo; nenhuma conclusão foi tirada.",
          affected: { assets: [a.assetId], objectives: [] }, impact: { portfolioPct: null, amount: null, description: `${(a.weight * 100).toFixed(1)}% da carteira sem avaliação atualizada.` },
          suggestedAction: "Verifique o status da fonte em Configurações › Fontes de dados ou atualize o valor manualmente.",
          evidence: [ev("Status", DATA_STATUS_LABEL[a.status]), ev("Último preço", a.price != null ? String(a.price) : "—")],
        });
      }
      continue;
    }

    // Price move since last check (or previous close).
    if (a.price != null && a.prevPrice != null && a.prevPrice > 0) {
      const move = a.price / a.prevPrice - 1;
      const thr = priceThreshold(a.assetClass, t);
      if (a.assetClass === "stablecoin") {
        const peg = a.peg ?? 1;
        const dev = Math.abs(a.price - peg) / peg;
        if (dev >= t.stablecoinDepeg) {
          const severity: Severity = dev >= 0.02 ? "critical" : "attention";
          out.push({
            rule: "stablecoin_depeg", fingerprint: `stablecoin_depeg:${pid}:${a.assetId}`, severity,
            title: `${a.symbol} fora da paridade (${(a.price).toFixed(4)})`,
            whatChanged: `${a.name} está cotada a ${a.price.toFixed(4)} USD, desvio de ${(dev * 100).toFixed(2)}% da paridade de ${peg.toFixed(2)}.`,
            whyMatters: "Perdas de paridade costumam sinalizar dúvidas sobre reservas ou resgates e podem se agravar rapidamente.",
            affected: { assets: [a.assetId], objectives: [objective] },
            impact: { portfolioPct: -dev * a.weight, amount: -dev * a.value, description: `Perda atual estimada de ${money(dev * a.value, ctx.baseCurrency)}.` },
            suggestedAction: severity === "critical" ? "Avalie reduzir a exposição ou migrar para stablecoin/instrumento com reservas mais transparentes; confirme liquidez na sua plataforma." : "Acompanhe de perto; verifique comunicados do emissor e liquidez de resgate.",
            evidence: [ev("Preço atual", a.price.toFixed(4)), ev("Paridade", peg.toFixed(2)), ev("Desvio", `${(dev * 100).toFixed(2)}%`)],
          });
        }
      } else if (Math.abs(move) >= thr) {
        const impactPct = move * a.weight;
        let severity: Severity = Math.abs(move) >= 2 * thr || Math.abs(impactPct) >= 0.03 ? "critical" : "attention";
        if (a.weight < t.minWeightForPriceAlert && severity !== "critical") severity = "info";
        if (Math.abs(impactPct) < 0.005 && severity === "critical" && a.weight < 0.1) severity = "attention";
        out.push({
          rule: "price_move", fingerprint: `price_move:${pid}:${a.assetId}:${move < 0 ? "down" : "up"}`, severity,
          title: `${a.symbol} ${move < 0 ? "caiu" : "subiu"} ${(Math.abs(move) * 100).toFixed(1)}%`,
          whatChanged: `${a.name} variou ${pct(move)} desde ${a.prevSource === "last_run" ? "a última verificação" : "o fechamento anterior"} (${a.prevPriceDate} → ${a.priceDate}).`,
          whyMatters: `A variação supera o limite configurado de ${(thr * 100).toFixed(1)}% para esta classe e o ativo representa ${(a.weight * 100).toFixed(1)}% da carteira.`,
          affected: { assets: [a.assetId], objectives: [objective] },
          impact: { portfolioPct: impactPct, amount: impactPct * ctx.totalValue, description: `Impacto estimado de ${pct(impactPct, 2)} na carteira (${money(impactPct * ctx.totalValue, ctx.baseCurrency)}).` },
          suggestedAction: move < 0
            ? "Verifique se houve mudança de fundamentos antes de agir. Quedas de preço isoladas não invalidam a tese; revise se o peso continua adequado."
            : "Avalie se o peso do ativo ultrapassou a alocação-alvo e se um rebalanceamento faz sentido.",
          evidence: [ev("Preço anterior", String(a.prevPrice), a.prevPriceDate), ev("Preço atual", String(a.price)), ev("Variação", pct(move)), ev("Limite configurado", `${(thr * 100).toFixed(1)}%`, null)],
        });
      }
    }

    // Volatility regime change.
    if (a.recentVol != null && a.longVol != null && a.longVol > 0 && a.weight >= t.minWeightForPriceAlert) {
      const ratio = a.recentVol / a.longVol;
      if (ratio >= t.volRatio && a.recentVol >= 0.1) {
        out.push({
          rule: "volatility", fingerprint: `volatility:${pid}:${a.assetId}`, severity: ratio >= t.volRatio * 1.5 ? "attention" : "info",
          title: `Volatilidade de ${a.symbol} em alta`,
          whatChanged: `Volatilidade de 20 dias de ${(a.recentVol * 100).toFixed(0)}% a.a., ${ratio.toFixed(1)}× a média de 1 ano (${(a.longVol * 100).toFixed(0)}%).`,
          whyMatters: "Regimes de volatilidade elevada aumentam a chance de perdas grandes no curto prazo.",
          affected: { assets: [a.assetId], objectives: [objective] },
          impact: { portfolioPct: null, amount: null, description: `Ativo representa ${(a.weight * 100).toFixed(1)}% da carteira.` },
          suggestedAction: "Confirme se o peso atual é compatível com seu limite de perdas.",
          evidence: [ev("Vol 20d", `${(a.recentVol * 100).toFixed(1)}%`), ev("Vol 1 ano", `${(a.longVol * 100).toFixed(1)}%`)],
        });
      }
    }

    // Risk score / category change.
    if (a.prevRiskScore != null && a.riskScore - a.prevRiskScore >= 2) {
      out.push({
        rule: "risk_change", fingerprint: `risk_change:${pid}:${a.assetId}`, severity: a.riskCategory === "muito_alto" ? "critical" : "attention",
        title: `Risco de ${a.symbol} aumentou para ${a.riskScore}/10`,
        whatChanged: `A nota de risco passou de ${a.prevRiskScore}/10 para ${a.riskScore}/10 (${RISK_CATEGORY_LABEL[a.riskCategory]}).`,
        whyMatters: "Mudança relevante no perfil de risco do ativo pode deixá-lo incompatível com sua carteira.",
        affected: { assets: [a.assetId], objectives: [objective] },
        impact: { portfolioPct: null, amount: null, description: `Ativo representa ${(a.weight * 100).toFixed(1)}% da carteira.` },
        suggestedAction: "Revise a tese do ativo e considere reduzir a exposição se o risco não for compatível com o seu perfil.",
        evidence: [ev("Nota anterior", `${a.prevRiskScore}/10`, null), ev("Nota atual", `${a.riskScore}/10`, null)],
      });
    }

    // Concentration.
    if (a.weight > t.maxSingleWeight && !["treasury_br", "treasury_us"].includes(a.assetClass)) {
      out.push({
        rule: "concentration", fingerprint: `concentration:${pid}:${a.assetId}`, severity: a.weight > t.maxSingleWeight + 0.15 ? "critical" : "attention",
        title: `Concentração elevada em ${a.symbol} (${(a.weight * 100).toFixed(0)}%)`,
        whatChanged: `${a.name} representa ${(a.weight * 100).toFixed(1)}% da carteira, acima do limite de ${(t.maxSingleWeight * 100).toFixed(0)}%.`,
        whyMatters: "Concentração amplia o impacto de um evento negativo específico sobre o patrimônio total.",
        affected: { assets: [a.assetId], objectives: [objective] },
        impact: { portfolioPct: null, amount: null, description: `Uma queda de 30% no ativo reduziria a carteira em ${(a.weight * 30).toFixed(1)}%.` },
        suggestedAction: "Considere diversificar parte da posição.",
        evidence: [ev("Peso atual", `${(a.weight * 100).toFixed(1)}%`, null), ev("Limite", `${(t.maxSingleWeight * 100).toFixed(0)}%`, null)],
      });
    }

    // Drift from target allocation.
    if (a.targetWeight != null) {
      const drift = a.weight - a.targetWeight;
      if (Math.abs(drift) >= t.driftPp) {
        out.push({
          rule: "drift", fingerprint: `drift:${pid}:${a.assetId}`, severity: Math.abs(drift) >= 2 * t.driftPp ? "attention" : "info",
          title: `${a.symbol} ${drift > 0 ? "acima" : "abaixo"} da alocação-alvo`,
          whatChanged: `Peso de ${(a.weight * 100).toFixed(1)}% vs. alvo de ${(a.targetWeight * 100).toFixed(1)}% (${pp(drift, 1)}).`,
          whyMatters: "Desvios em relação ao alvo mudam o risco e o retorno esperado da carteira planejada.",
          affected: { assets: [a.assetId], objectives: [objective] },
          impact: { portfolioPct: drift, amount: drift * ctx.totalValue, description: `Rebalancear exigiria movimentar cerca de ${money(Math.abs(drift) * ctx.totalValue, ctx.baseCurrency)}.` },
          suggestedAction: "Avalie rebalancear com novos aportes ou resgates, considerando custos e impostos.",
          evidence: [ev("Peso atual", `${(a.weight * 100).toFixed(1)}%`, null), ev("Alvo", `${(a.targetWeight * 100).toFixed(1)}%`, null)],
        });
      }
    }
  }

  // Events (credit, regulatory, liquidity, counterparty, fundamentals, crypto) for held assets or market-wide.
  const held = new Set(ctx.assets.map((a) => a.assetId));
  for (const e of ctx.events) {
    if (e.assetId && !held.has(e.assetId)) continue;
    const asset = ctx.assets.find((a) => a.assetId === e.assetId);
    out.push({
      rule: `event_${e.type}`, fingerprint: `event:${pid}:${e.id}`, severity: e.severity,
      title: e.title,
      whatChanged: e.description,
      whyMatters: eventWhy(e.type),
      affected: { assets: e.assetId ? [e.assetId] : [], objectives: [objective] },
      impact: { portfolioPct: null, amount: null, description: asset ? `${asset.name} representa ${(asset.weight * 100).toFixed(1)}% da carteira (${money(asset.value, ctx.baseCurrency)}).` : "Evento de mercado com impacto indireto." },
      suggestedAction: e.severity === "critical" ? "Revise a posição imediatamente; confirme com o emissor/plataforma as condições de resgate e considere reduzir a exposição." : "Acompanhe os desdobramentos e revise a tese.",
      evidence: [{ label: "Evento", value: e.title, source: e.sourceName, asOf: e.occurredAt, isDemo: e.isDemo }],
    });
  }

  // Macro: rates and FX.
  const { current: m, previous: pm } = ctx.macro;
  if (pm) {
    const dCdi = m.cdi - pm.cdi;
    if (Math.abs(dCdi) >= t.rateMovePp && ctx.fixedIncomeWeight > 0.05) {
      out.push({
        rule: "rates_br", fingerprint: `rates_br:${pid}:${m.asOf}`, severity: "info",
        title: `CDI ${dCdi > 0 ? "subiu" : "caiu"} ${(Math.abs(dCdi) * 100).toFixed(2)} p.p.`,
        whatChanged: `CDI anualizado passou de ${(pm.cdi * 100).toFixed(2)}% para ${(m.cdi * 100).toFixed(2)}%.`,
        whyMatters: "Afeta o rendimento de ativos pós-fixados e a marcação a mercado de prefixados e IPCA+.",
        affected: { assets: [], objectives: [objective] },
        impact: { portfolioPct: null, amount: null, description: `${(ctx.fixedIncomeWeight * 100).toFixed(0)}% da carteira em renda fixa.` },
        suggestedAction: dCdi > 0 ? "Pós-fixados passam a render mais; prefixados longos podem ter perdas na marcação." : "Avalie travar taxas prefixadas/IPCA+ se compatível com seu horizonte.",
        evidence: [{ label: "CDI anterior", value: `${(pm.cdi * 100).toFixed(2)}%`, source: "Banco Central (SGS 12)", asOf: pm.asOf, isDemo: pm.origin.CDI === "demo" }, { label: "CDI atual", value: `${(m.cdi * 100).toFixed(2)}%`, source: "Banco Central (SGS 12)", asOf: m.asOf, isDemo: m.origin.CDI === "demo" }],
      });
    }
    const dUst = m.ust3m - pm.ust3m;
    if (Math.abs(dUst) >= t.rateMovePp && ctx.assets.some((a) => ["treasury_us", "fund", "tokenized", "corporate_bond"].includes(a.assetClass))) {
      out.push({
        rule: "rates_us", fingerprint: `rates_us:${pid}:${m.asOf}`, severity: "info",
        title: `T-Bill 3M ${dUst > 0 ? "subiu" : "caiu"} ${(Math.abs(dUst) * 100).toFixed(2)} p.p.`,
        whatChanged: `Taxa do T-Bill 3M passou de ${(pm.ust3m * 100).toFixed(2)}% para ${(m.ust3m * 100).toFixed(2)}%.`,
        whyMatters: "Altera o rendimento de money markets e T-Bills tokenizados e o preço de bonds de prazo mais longo.",
        affected: { assets: [], objectives: [objective] }, impact: { portfolioPct: null, amount: null, description: "Efeito via renda fixa em dólar." },
        suggestedAction: "Nenhuma ação imediata necessária; reavalie a duration da parcela em dólar.",
        evidence: [{ label: "T-Bill 3M atual", value: `${(m.ust3m * 100).toFixed(2)}%`, source: "U.S. Treasury", asOf: m.asOf, isDemo: m.origin.UST3M === "demo" }],
      });
    }
    const dFx = m.usdbrl / pm.usdbrl - 1;
    if (Math.abs(dFx) >= t.fxMove && ctx.fxExposure >= 0.1) {
      const impactPct = (ctx.baseCurrency === "BRL" ? dFx : -dFx) * ctx.fxExposure;
      out.push({
        rule: "fx", fingerprint: `fx:${pid}:${m.asOf}`, severity: Math.abs(dFx) >= 2 * t.fxMove ? "attention" : "info",
        title: `Dólar ${dFx > 0 ? "subiu" : "caiu"} ${(Math.abs(dFx) * 100).toFixed(1)}% frente ao real`,
        whatChanged: `USD/BRL passou de ${pm.usdbrl.toFixed(4)} para ${m.usdbrl.toFixed(4)}.`,
        whyMatters: `${(ctx.fxExposure * 100).toFixed(0)}% da carteira tem exposição cambial em relação à sua moeda-base (${ctx.baseCurrency}).`,
        affected: { assets: [], objectives: [objective] },
        impact: { portfolioPct: impactPct, amount: impactPct * ctx.totalValue, description: `Efeito cambial estimado de ${pct(impactPct, 2)} na carteira.` },
        suggestedAction: "Verifique se a exposição cambial continua alinhada à sua meta.",
        evidence: [{ label: "USD/BRL anterior", value: pm.usdbrl.toFixed(4), source: "Banco Central (PTAX)", asOf: pm.asOf, isDemo: pm.origin.USDBRL === "demo" }, { label: "USD/BRL atual", value: m.usdbrl.toFixed(4), source: "Banco Central (PTAX)", asOf: m.asOf, isDemo: m.origin.USDBRL === "demo" }],
      });
    }
  }

  // Portfolio-level: risk vs profile, drawdown, crypto cap.
  if (ctx.portfolioRisk > ctx.profile.maxRiskScore) {
    out.push({
      rule: "profile_mismatch", fingerprint: `profile_mismatch:${pid}`, severity: ctx.portfolioRisk - ctx.profile.maxRiskScore >= 2 ? "critical" : "attention",
      title: `Risco da carteira acima do seu perfil`,
      whatChanged: `Nota de risco consolidada ${ctx.portfolioRisk}/10 vs. limite de ${ctx.profile.maxRiskScore}/10 do perfil ${ctx.profile.label}.`,
      whyMatters: "A carteira pode sofrer perdas maiores do que você declarou suportar.",
      affected: { assets: [], objectives: [objective] }, impact: { portfolioPct: null, amount: null, description: "Risco consolidado incompatível com o perfil." },
      suggestedAction: "Reduza a exposição aos ativos de maior risco ou revise seu perfil se suas circunstâncias mudaram.",
      evidence: [{ label: "Risco da carteira", value: `${ctx.portfolioRisk}/10`, source: "Atlas Risk Engine", asOf: ctx.analyzedAt }],
    });
  }
  if (ctx.peakValue && ctx.peakValue > 0) {
    const dd = 1 - ctx.totalValue / ctx.peakValue;
    if (dd >= ctx.profile.maxDrawdown * 0.75) {
      out.push({
        rule: "drawdown", fingerprint: `drawdown:${pid}`, severity: dd >= ctx.profile.maxDrawdown ? "critical" : "attention",
        title: `Carteira ${(dd * 100).toFixed(1)}% abaixo do pico`,
        whatChanged: `Valor atual ${money(ctx.totalValue, ctx.baseCurrency)} vs. pico monitorado de ${money(ctx.peakValue, ctx.baseCurrency)}.`,
        whyMatters: `Seu limite de queda tolerável é de ${(ctx.profile.maxDrawdown * 100).toFixed(0)}%.`,
        affected: { assets: [], objectives: [objective] }, impact: { portfolioPct: -dd, amount: ctx.totalValue - ctx.peakValue, description: "Queda acumulada desde o pico monitorado." },
        suggestedAction: "Revise se a carteira ainda está alinhada ao seu limite de perdas antes de tomar decisões impulsivas.",
        evidence: [{ label: "Queda desde o pico", value: `${(dd * 100).toFixed(1)}%`, source: "Atlas Monitor", asOf: ctx.analyzedAt }],
      });
    }
  }
  const cryptoW = ctx.assets.filter((a) => a.assetClass === "crypto").reduce((s, a) => s + a.weight, 0);
  if (cryptoW > ctx.profile.maxCryptoWeight + 0.01) {
    out.push({
      rule: "crypto_cap", fingerprint: `crypto_cap:${pid}`, severity: cryptoW > ctx.profile.maxCryptoWeight * 2 + 0.02 ? "critical" : "attention",
      title: `Cripto em ${(cryptoW * 100).toFixed(1)}% da carteira`,
      whatChanged: `Exposição a criptoativos acima do limite de ${(ctx.profile.maxCryptoWeight * 100).toFixed(0)}% do seu perfil.`,
      whyMatters: "Criptoativos já tiveram quedas superiores a 70%.",
      affected: { assets: ctx.assets.filter((a) => a.assetClass === "crypto").map((a) => a.assetId), objectives: [objective] },
      impact: { portfolioPct: -cryptoW * 0.7, amount: -cryptoW * 0.7 * ctx.totalValue, description: `Uma queda de 70% em cripto reduziria a carteira em ${(cryptoW * 70).toFixed(1)}%.` },
      suggestedAction: "Considere reduzir a exposição para dentro do limite do perfil.",
      evidence: [{ label: "Peso em cripto", value: `${(cryptoW * 100).toFixed(1)}%`, source: "Atlas Monitor", asOf: ctx.analyzedAt }],
    });
  }

  return out.filter((c) => SEVERITY_RANK[c.severity] >= SEVERITY_RANK[t.minSeverity]);
}

function eventWhy(type: string): string {
  switch (type) {
    case "credit":
      return "Eventos de crédito aumentam a probabilidade de atraso ou perda do principal, especialmente acima do limite de garantias (FGC/FDIC).";
    case "regulatory":
      return "Mudanças regulatórias podem alterar acesso, tributação ou a própria viabilidade do produto.";
    case "liquidity":
      return "Restrições de liquidez podem impedir resgates quando você precisar dos recursos.";
    case "counterparty":
      return "Problemas na plataforma/custodiante podem bloquear ou comprometer seus ativos.";
    case "fundamentals":
      return "Deterioração de fundamentos pode invalidar a tese de investimento.";
    case "crypto":
      return "Eventos específicos de cripto (falhas de protocolo, perda de paridade, hacks) podem causar perdas rápidas e permanentes.";
    default:
      return "Evento relevante para os ativos da carteira.";
  }
}

export interface RecentAlert {
  fingerprint: string;
  severity: Severity;
  lastSeenAt: string;
}

/** Suppress repeated alerts inside the cooldown window unless severity escalated. */
export function dedupe(candidates: AlertCandidate[], recent: RecentAlert[], now: Date, cooldownHours: number) {
  const create: AlertCandidate[] = [];
  const repeated: AlertCandidate[] = [];
  const byFp = new Map(recent.map((r) => [r.fingerprint, r]));
  for (const c of candidates) {
    const prev = byFp.get(c.fingerprint);
    if (prev) {
      const ageH = (now.getTime() - Date.parse(prev.lastSeenAt)) / 3600000;
      const escalated = SEVERITY_RANK[c.severity] > SEVERITY_RANK[prev.severity];
      if (ageH < cooldownHours && !escalated) {
        repeated.push(c);
        continue;
      }
    }
    create.push(c);
  }
  return { create, repeated };
}
