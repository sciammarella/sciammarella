// Explainable investor profile — methodology profile-v1.0.
// The effective risk level is the MINIMUM of declared loss tolerance and the
// capacity implied by horizon, liquidity need, experience and objective. The
// target return is deliberately NOT an input to the risk level.

import { HORIZON_YEARS } from "./analytics";
import type { DerivedProfile, Experience, ProfileAnswers, RiskLevel } from "./types";

export const PROFILE_METHODOLOGY_VERSION = "profile-v1.0";

export const LEVEL_LABEL: Record<RiskLevel, string> = { 1: "Conservador", 2: "Moderado", 3: "Arrojado", 4: "Agressivo" };

const TOLERANCE: Record<ProfileAnswers["lossTolerance"], RiskLevel> = { low: 1, moderate: 2, high: 3, very_high: 4 };
const HORIZON_CAP: Record<ProfileAnswers["horizon"], RiskLevel> = { lt1: 1, "1to3": 2, "3to5": 3, gt5: 4 };
const LIQUIDITY_CAP: Record<ProfileAnswers["liquidityNeed"], RiskLevel> = { daily: 2, monthly: 3, annual: 4, none: 4 };
const OBJECTIVE_CAP: Record<ProfileAnswers["objective"], RiskLevel> = { preservation: 1, income: 2, growth: 4, high_growth: 4 };
const EXPERIENCE_CAP: Record<Experience, RiskLevel> = { none: 2, basic: 3, intermediate: 4, advanced: 4 };

export const OBJECTIVE_LABEL: Record<ProfileAnswers["objective"], string> = {
  preservation: "Preservação de capital",
  income: "Renda",
  growth: "Crescimento patrimonial",
  high_growth: "Alto crescimento",
};
export const TOLERANCE_LABEL: Record<ProfileAnswers["lossTolerance"], string> = { low: "Baixa", moderate: "Moderada", high: "Alta", very_high: "Muito alta" };
export const LIQUIDITY_LABEL: Record<ProfileAnswers["liquidityNeed"], string> = { daily: "Diária", monthly: "Mensal", annual: "Anual", none: "Sem necessidade imediata" };
export const EXPERIENCE_LABEL: Record<Experience, string> = { none: "Nenhuma", basic: "Básica", intermediate: "Intermediária", advanced: "Avançada" };

const MAX_RISK: Record<RiskLevel, number> = { 1: 3, 2: 5, 3: 6, 4: 8 };
const MAX_DD: Record<RiskLevel, number> = { 1: 0.05, 2: 0.15, 3: 0.3, 4: 0.5 };
const CRYPTO_CAP: Record<RiskLevel, number> = { 1: 0, 2: 0.03, 3: 0.08, 4: 0.15 };
const TOKENIZED_CAP: Record<RiskLevel, number> = { 1: 0, 2: 0.03, 3: 0.07, 4: 0.1 };
const MIN_LIQUID: Record<ProfileAnswers["liquidityNeed"], number> = { daily: 0.6, monthly: 0.35, annual: 0.15, none: 0 };

export function deriveProfile(a: ProfileAnswers): DerivedProfile {
  const caps: { level: RiskLevel; reason: string }[] = [
    { level: TOLERANCE[a.lossTolerance], reason: `tolerância a perdas declarada: ${TOLERANCE_LABEL[a.lossTolerance].toLowerCase()}` },
    { level: HORIZON_CAP[a.horizon], reason: `horizonte de investimento (${a.horizon === "lt1" ? "menos de 1 ano" : a.horizon === "1to3" ? "1 a 3 anos" : a.horizon === "3to5" ? "3 a 5 anos" : "mais de 5 anos"})` },
    { level: LIQUIDITY_CAP[a.liquidityNeed], reason: `necessidade de liquidez ${LIQUIDITY_LABEL[a.liquidityNeed].toLowerCase()}` },
    { level: OBJECTIVE_CAP[a.objective], reason: `objetivo de ${OBJECTIVE_LABEL[a.objective].toLowerCase()}` },
    { level: EXPERIENCE_CAP[a.experience], reason: `experiência com investimentos ${EXPERIENCE_LABEL[a.experience].toLowerCase()}` },
  ];
  const level = Math.min(...caps.map((c) => c.level)) as RiskLevel;
  const binding = caps.filter((c) => c.level === level).map((c) => c.reason);

  const explanation: string[] = [
    `Perfil ${LEVEL_LABEL[level]} (nível ${level} de 4).`,
    `O nível é o menor entre os limites de cada resposta. O fator determinante foi: ${binding.join("; ")}.`,
  ];
  if (TOLERANCE[a.lossTolerance] > level) {
    explanation.push(`Embora você tenha declarado tolerância ${TOLERANCE_LABEL[a.lossTolerance].toLowerCase()}, sua capacidade de assumir risco é limitada pelos fatores acima.`);
  }
  explanation.push(
    `Sua meta de ${(a.targetReturn * 100).toFixed(1)}% ao ano não foi usada para aumentar o nível de risco. Uma meta alta não significa capacidade de suportar perdas.`,
  );

  let maxCrypto = CRYPTO_CAP[level];
  const constraints: string[] = [];
  const cryptoAllowed = !a.excludedClasses.includes("crypto") && (a.allowedClasses.length === 0 || a.allowedClasses.includes("crypto"));
  if (!cryptoAllowed) maxCrypto = 0;
  else if (a.cryptoExperience === "none" && maxCrypto > 0.02) {
    maxCrypto = 0.02;
    constraints.push("Exposição a cripto limitada a 2% por falta de experiência declarada com criptoativos.");
  }
  let maxTokenized = TOKENIZED_CAP[level];
  if (a.excludedClasses.includes("tokenized")) maxTokenized = 0;

  constraints.push(`Nota de risco máxima da carteira: ${MAX_RISK[level]}/10.`);
  constraints.push(`Queda máxima tolerável estimada: ${(MAX_DD[level] * 100).toFixed(0)}%.`);
  if (MIN_LIQUID[a.liquidityNeed] > 0) constraints.push(`Pelo menos ${(MIN_LIQUID[a.liquidityNeed] * 100).toFixed(0)}% em ativos resgatáveis em até 5 dias úteis.`);
  constraints.push(`Cripto até ${(maxCrypto * 100).toFixed(0)}%; tokenizados até ${(maxTokenized * 100).toFixed(0)}%.`);
  if (a.residenceCountry === "OTHER") constraints.push("Residência fora de BR/EUA: disponibilidade de produtos não verificada — confirme elegibilidade com cada instituição.");

  return {
    level,
    label: LEVEL_LABEL[level],
    maxRiskScore: MAX_RISK[level],
    maxDrawdown: MAX_DD[level],
    maxCryptoWeight: maxCrypto,
    maxTokenizedWeight: maxTokenized,
    minLiquidWeight: MIN_LIQUID[a.liquidityNeed],
    horizonYears: HORIZON_YEARS[a.horizon],
    explanation,
    constraints,
    methodologyVersion: PROFILE_METHODOLOGY_VERSION,
  };
}
