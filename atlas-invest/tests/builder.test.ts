import { describe, expect, it } from "vitest";
import { analyzeAsset } from "@/domain/analytics";
import { assessTargetFeasibility, buildProposal, capAndNormalize, type Candidate } from "@/domain/builder";
import { CATALOG } from "@/domain/catalog";
import { generateDemoSeries } from "@/domain/demo-market";
import { evaluateOpportunity } from "@/domain/discovery";
import { analyzePortfolio, applyStress, STRESS_SCENARIOS } from "@/domain/portfolio";
import { deriveProfile } from "@/domain/profile";
import type { MacroSnapshot, ProfileAnswers } from "@/domain/types";

const macro: MacroSnapshot = { cdi: 0.149, selic: 0.15, ipca12m: 0.048, usdbrl: 5.42, ust3m: 0.039, ust10y: 0.042, asOf: "2026-10-16", origin: {} };
const answers: ProfileAnswers = {
  residenceCountry: "BR", baseCurrency: "BRL", amount: 100000, objective: "growth", targetReturn: 0.6, horizon: "3to5", lossTolerance: "moderate",
  liquidityNeed: "monthly", markets: ["BR", "US"], allowedClasses: [], excludedClasses: [], experience: "intermediate", cryptoExperience: "basic",
};
const prices = new Map(CATALOG.map((s) => [s.id, s.pricing === "quoted" ? generateDemoSeries(s, "2023-10-18", "2026-10-16") : []]));
function candidates(a: ProfileAnswers): Candidate[] {
  const p = deriveProfile(a);
  return CATALOG.map((spec) => {
    const an = analyzeAsset(spec, { prices: prices.get(spec.id)!, origin: "demo", sourceName: "demo", lastUpdated: null, status: "ok" }, macro, a.baseCurrency, p.horizonYears);
    return { spec, analytics: an, opportunity: evaluateOpportunity(spec, an, a, p) };
  });
}

describe("portfolio builder", () => {
  const cands = candidates(answers);
  const profile = deriveProfile(answers);
  const proposals = (["conservative", "balanced", "aggressive"] as const).map((s) => buildProposal(s, cands, answers, profile));

  it("weights sum to 100% and respect single-asset caps", () => {
    for (const p of proposals) {
      const sum = p.lines.reduce((s, l) => s + l.weight, 0);
      expect(sum).toBeCloseTo(1, 2);
      for (const l of p.lines) {
        const sovereign = cands.find((c) => c.spec.id === l.assetId)!.spec.credit.kind === "sovereign";
        expect(l.weight).toBeLessThanOrEqual((sovereign ? 0.45 : 0.25) + 1e-6);
      }
    }
  });
  it("respects crypto and liquidity limits of the profile", () => {
    for (const p of proposals) {
      const crypto = p.lines.filter((l) => cands.find((c) => c.spec.id === l.assetId)!.spec.assetClass === "crypto").reduce((s, l) => s + l.weight, 0);
      expect(crypto).toBeLessThanOrEqual(profile.maxCryptoWeight + 1e-6);
    }
  });
  it("only uses eligible assets and honours exclusions", () => {
    const noCrypto = { ...answers, excludedClasses: ["crypto" as const, "tokenized" as const] };
    const p = buildProposal("aggressive", candidates(noCrypto), noCrypto, deriveProfile(noCrypto));
    const classes = p.lines.map((l) => cands.find((c) => c.spec.id === l.assetId)!.spec.assetClass);
    expect(classes).not.toContain("crypto");
    expect(classes).not.toContain("tokenized");
    for (const l of proposals[1].lines) expect(cands.find((c) => c.spec.id === l.assetId)!.opportunity.eligible).toBe(true);
  });
  it("conservative proposal is less risky than aggressive", () => {
    const m = proposals.map((p) => analyzePortfolio(p.lines.map((l) => {
      const c = cands.find((x) => x.spec.id === l.assetId)!;
      return { spec: c.spec, analytics: c.analytics, valueBase: 100000 * l.weight, prices: prices.get(c.spec.id)!, origin: "manual" as const, valuation: "market_demo" as const };
    }), "BRL", 4)!);
    expect(m[0].volatility).toBeLessThan(m[2].volatility);
    expect(Math.min(...m[0].stress.map((s) => s.impact))).toBeGreaterThan(Math.min(...m[2].stress.map((s) => s.impact)));
  });
  it("states clearly when the target is incompatible", () => {
    const f = assessTargetFeasibility(0.6, [{ strategy: "balanced", expectedReturn: 0.16, riskScore: 5, compatible: true }]);
    expect(f.status).toBe("incompatível");
    expect(f.message).toMatch(/não é compatível/);
    expect(assessTargetFeasibility(0.12, [{ strategy: "balanced", expectedReturn: 0.16, riskScore: 5, compatible: true }]).status).toBe("compatível");
    expect(assessTargetFeasibility(0.12, [{ strategy: "aggressive", expectedReturn: 0.3, riskScore: 9, compatible: false }]).status).toBe("incompatível");
  });
  it("cap redistribution keeps the total at 100%", () => {
    const lines = [{ assetId: "US-VOO", weight: 0.6, sleeve: "equity" as const, rationale: "" }, { assetId: "BR-BOVA11", weight: 0.2, sleeve: "equity" as const, rationale: "" }, { assetId: "US-QQQ", weight: 0.2, sleeve: "equity" as const, rationale: "" }, { assetId: "BR-ITUB4", weight: 0.2, sleeve: "equity" as const, rationale: "" }];
    capAndNormalize(lines, cands);
    expect(lines.reduce((s, l) => s + l.weight, 0)).toBeCloseTo(1, 9);
    expect(lines[0].weight).toBeLessThanOrEqual(0.25 + 1e-9);
  });
  it("stress applies FX translation for foreign assets", () => {
    const voo = cands.find((c) => c.spec.id === "US-VOO")!.spec;
    const brCrisis = STRESS_SCENARIOS.find((s) => s.id === "br_crisis")!;
    const r = applyStress([{ spec: voo, weight: 1 }], brCrisis, "BRL");
    expect(r.impact).toBeCloseTo((1 - 0.05) * 1.3 - 1, 9);
    expect(applyStress([{ spec: voo, weight: 1 }], brCrisis, "USD").impact).toBeCloseTo(-0.05, 9);
  });
});
