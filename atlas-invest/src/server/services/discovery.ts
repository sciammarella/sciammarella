// InvestmentDiscoveryService + RiskEngine persistence.

import { analyzeAsset, CMA_METHODOLOGY_VERSION, type AssetAnalytics, type AssetMarketData } from "@/domain/analytics";
import { CATALOG, CATALOG_BY_ID } from "@/domain/catalog";
import { evaluateOpportunity, type Opportunity } from "@/domain/discovery";
import { RISK_METHODOLOGY_VERSION } from "@/domain/risk";
import type { AssetSpec, Currency, MacroSnapshot } from "@/domain/types";
import type { Tx } from "@/server/db";
import { withSystem } from "@/server/db";
import { getMacroSnapshot, getMarketData, todayISO } from "./market-data";
import type { StoredProfile } from "./profile";

export interface AnalyzedAsset {
  spec: AssetSpec;
  md: AssetMarketData;
  analytics: AssetAnalytics;
}

export async function loadAnalytics(tx: Tx, assetIds: string[] | "all", base: Currency, horizonYears: number): Promise<{ macro: MacroSnapshot; assets: Map<string, AnalyzedAsset> }> {
  const ids = assetIds === "all" ? CATALOG.map((a) => a.id) : assetIds;
  const macro = await getMacroSnapshot(tx);
  const mdMap = await getMarketData(tx, ids, macro);
  const assets = new Map<string, AnalyzedAsset>();
  for (const id of ids) {
    const spec = CATALOG_BY_ID.get(id);
    const md = mdMap.get(id);
    if (!spec || !md) continue;
    assets.set(id, { spec, md, analytics: analyzeAsset(spec, md, macro, base, horizonYears) });
  }
  return { macro, assets };
}

export interface DiscoveryItem extends AnalyzedAsset {
  opportunity: Opportunity;
}

export async function discover(tx: Tx, profile: StoredProfile): Promise<{ macro: MacroSnapshot; items: DiscoveryItem[] }> {
  const { macro, assets } = await loadAnalytics(tx, "all", profile.answers.baseCurrency, profile.derived.horizonYears);
  const items: DiscoveryItem[] = [...assets.values()].map((a) => ({ ...a, opportunity: evaluateOpportunity(a.spec, a.analytics, profile.answers, profile.derived) }));
  items.sort((x, y) => Number(y.opportunity.eligible) - Number(x.opportunity.eligible) || y.opportunity.compatibilityScore - x.opportunity.compatibilityScore);
  return { macro, items };
}

/** Persist risk snapshots for the catalog (system context; shared, non-personal data). */
export async function persistRiskMetrics(assets: Map<string, AnalyzedAsset>, base: Currency): Promise<void> {
  await withSystem(async (tx) => {
    for (const a of assets.values()) {
      const an = a.analytics;
      await tx.query(
        `insert into risk_metrics(asset_id, base_currency, methodology_version, data_as_of, score, category, components, metrics, limitations, is_demo_data)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          a.spec.id, base, `${RISK_METHODOLOGY_VERSION}+${CMA_METHODOLOGY_VERSION}`, an.lastPriceDate ?? todayISO(), an.risk.score, an.risk.category,
          JSON.stringify(an.risk.components), JSON.stringify({ historical: an.historical, expected: an.expected?.scenarios ?? null, dataQuality: an.dataQuality }),
          JSON.stringify(an.risk.limitations), a.md.origin !== "real",
        ],
      );
    }
  });
}
