// Investment Discovery: eligibility and profile compatibility for each asset.

import type { AssetAnalytics } from "./analytics";
import type { AssetSpec, DerivedProfile, ProfileAnswers } from "./types";

export type Compatibility = "alta" | "média" | "baixa" | "incompatível";

export interface Opportunity {
  assetId: string;
  eligible: boolean;
  eligibilityIssues: string[];
  compatibility: Compatibility;
  compatibilityScore: number; // 0..100
  reasons: string[];
  warnings: string[];
  meetsTargetInBase: boolean;
  rationale: string;
}

export function classAllowed(spec: AssetSpec, a: ProfileAnswers): boolean {
  if (a.excludedClasses.includes(spec.assetClass)) return false;
  if (a.allowedClasses.length > 0 && !a.allowedClasses.includes(spec.assetClass)) return false;
  return true;
}

export function marketAllowed(spec: AssetSpec, a: ProfileAnswers): boolean {
  if (spec.market === "GLOBAL") return true;
  return a.markets.includes(spec.market);
}

export function eligibilityIssues(spec: AssetSpec, a: ProfileAnswers): string[] {
  const issues: string[] = [];
  const tags = spec.regulatory.eligibility ?? [];
  if (tags.includes("br_resident_only") && a.residenceCountry !== "BR") issues.push("Disponível principalmente para residentes no Brasil (CPF e conta em instituição brasileira).");
  if (tags.includes("us_resident_only") && a.residenceCountry !== "US") issues.push("Normalmente exige residência nos EUA; verifique alternativas via corretora internacional.");
  if (tags.includes("qualified_investor") && !a.qualifiedInvestor) issues.push("Restrito a investidores qualificados/profissionais e sujeito a KYC e mínimos elevados.");
  return issues;
}

export function evaluateOpportunity(spec: AssetSpec, an: AssetAnalytics, a: ProfileAnswers, p: DerivedProfile): Opportunity {
  const issues = eligibilityIssues(spec, a);
  if (!marketAllowed(spec, a)) issues.push(`Mercado ${spec.market === "BR" ? "Brasil" : "EUA"} não selecionado no seu perfil.`);
  if (!classAllowed(spec, a)) issues.push("Classe de ativo excluída nas suas preferências.");

  const reasons: string[] = [];
  const warnings: string[] = [];
  let score = 70;
  const risk = an.risk.score;
  const over = risk - p.maxRiskScore;
  if (over <= 0) {
    reasons.push(`Risco ${risk}/10 dentro do limite do seu perfil (${p.maxRiskScore}/10).`);
    score += 10;
  } else {
    warnings.push(`Risco ${risk}/10 acima do limite do seu perfil (${p.maxRiskScore}/10)${over <= 2 ? "; usar apenas como parcela pequena" : ""}.`);
    score -= over * 15;
  }

  const isCrypto = spec.assetClass === "crypto" || spec.assetClass === "stablecoin";
  if (isCrypto && p.maxCryptoWeight === 0) {
    warnings.push("Seu perfil não comporta exposição a criptoativos.");
    score = Math.min(score, 10);
  }
  if (spec.assetClass === "tokenized" && p.maxTokenizedWeight === 0) {
    warnings.push("Seu perfil não comporta ativos tokenizados.");
    score = Math.min(score, 10);
  }

  if (spec.lockedUntilMaturity && a.liquidityNeed === "daily") {
    warnings.push("Sem liquidez antes do vencimento, incompatível com necessidade de liquidez diária para a parcela de reserva.");
    score -= 20;
  } else if (spec.liquidityDays <= 2) {
    reasons.push("Liquidez alta (resgate em até D+2).");
    score += 5;
  }
  if (spec.minHorizonYears && spec.minHorizonYears > p.horizonYears) {
    warnings.push(`Horizonte recomendado de pelo menos ${spec.minHorizonYears} ano(s), maior que o seu (${p.horizonYears}).`);
    score -= 15;
  }

  const sc = an.expected?.scenarios;
  const meetsTarget = !!sc && sc.base >= a.targetReturn;
  if (sc) {
    if (meetsTarget) {
      reasons.push(`Cenário-base estimado (${(sc.base * 100).toFixed(1)}% a.a.) igual ou acima da sua meta de ${(a.targetReturn * 100).toFixed(1)}%.`);
      score += 10;
    } else {
      warnings.push(`Cenário-base estimado (${(sc.base * 100).toFixed(1)}% a.a.) abaixo da sua meta de ${(a.targetReturn * 100).toFixed(1)}%.`);
    }
    if (-sc.pessimistic > p.maxDrawdown && sc.pessimistic < 0) {
      warnings.push(`Cenário pessimista (${(sc.pessimistic * 100).toFixed(1)}% a.a.) excede a queda tolerável do seu perfil.`);
      score -= 10;
    }
  }
  if (an.dataQuality.label === "baixa") {
    warnings.push("Qualidade de dados baixa: conclusões menos confiáveis.");
    score -= 5;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  let compatibility: Compatibility = score >= 75 ? "alta" : score >= 55 ? "média" : score >= 30 ? "baixa" : "incompatível";
  if (issues.length > 0) compatibility = "incompatível";
  if (over > 2) compatibility = "incompatível";

  const rationale = buildRationale(spec, an, compatibility, reasons, warnings);
  return { assetId: spec.id, eligible: issues.length === 0, eligibilityIssues: issues, compatibility, compatibilityScore: issues.length ? 0 : score, reasons, warnings, meetsTargetInBase: meetsTarget, rationale };
}

function buildRationale(spec: AssetSpec, an: AssetAnalytics, c: Compatibility, reasons: string[], warnings: string[]): string {
  const sc = an.expected?.scenarios;
  const head = `${spec.name}: risco ${an.risk.score}/10 (${an.risk.category.replace("_", " ")})`;
  const ret = sc ? `, faixa estimada de ${(sc.pessimistic * 100).toFixed(1)}% a ${(sc.optimistic * 100).toFixed(1)}% a.a. (base ${(sc.base * 100).toFixed(1)}%)` : "";
  const fit = c === "incompatível" ? "Não recomendado para o seu perfil." : c === "alta" ? "Boa aderência ao seu perfil." : c === "média" ? "Aderência parcial ao seu perfil." : "Aderência baixa; considerar apenas em pequena parcela.";
  const why = [...reasons.slice(0, 2), ...warnings.slice(0, 2)].join(" ");
  return `${head}${ret}. ${fit} ${why}`.trim();
}
