// One-time initialization: migrations (in getDriver), catalog sync, demo data and
// the demo account. Memoized per process.

import { addDays } from "@/domain/calendar";
import { CATALOG_BY_ID } from "@/domain/catalog";
import type { ProfileAnswers } from "@/domain/types";
import { withSystem, withUser } from "@/server/db";
import { createUser } from "./services/auth";
import { ensureDemoData, syncCatalog, todayISO } from "./services/market-data";
import { runMonitoring } from "./services/monitoring";
import { addPosition, createPortfolio } from "./services/portfolio";
import { saveProfile } from "./services/profile";

export const DEMO_EMAIL = "demo@atlas.local";
export const DEMO_PASSWORD = "atlas-demo-2026";

const g = globalThis as unknown as { __atlasReady?: Promise<void> };

export function ensureReady(): Promise<void> {
  if (!g.__atlasReady) {
    g.__atlasReady = (async () => {
      await withSystem(async (tx) => {
        await syncCatalog(tx);
        await ensureDemoData(tx);
      });
      await ensureDemoAccount();
    })().catch((e) => {
      g.__atlasReady = undefined;
      throw e;
    });
  }
  return g.__atlasReady;
}

export const DEMO_PROFILE: ProfileAnswers = {
  residenceCountry: "BR",
  baseCurrency: "BRL",
  amount: 350000,
  objective: "growth",
  targetReturn: 0.16,
  horizon: "3to5",
  lossTolerance: "moderate",
  liquidityNeed: "monthly",
  markets: ["BR", "US"],
  allowedClasses: [],
  excludedClasses: [],
  experience: "intermediate",
  cryptoExperience: "basic",
};

async function ensureDemoAccount(): Promise<void> {
  const exists = await withSystem(async (tx) => (await tx.query(`select id from users where email = $1`, [DEMO_EMAIL]))[0] as { id: string } | undefined);
  if (exists) return;
  const userId = await withSystem((tx) => createUser(tx, DEMO_EMAIL, DEMO_PASSWORD, "Conta demonstração", true));
  const today = todayISO();
  const d = (days: number) => addDays(today, -days);
  await withUser(userId, async (tx) => {
    await saveProfile(tx, userId, DEMO_PROFILE);
    const pf = await createPortfolio(tx, userId, {
      name: "Carteira principal (demo)",
      description: "Carteira de demonstração com posições fictícias para testar o fluxo completo.",
      baseCurrency: "BRL",
      strategy: "balanced",
      targets: [
        { assetId: "BR-TD-SELIC-2029", weight: 0.15, rationale: "Reserva de liquidez" },
        { assetId: "BR-TD-IPCA-2035", weight: 0.12, rationale: "Proteção contra inflação" },
        { assetId: "BR-CDB-MED-115", weight: 0.08, rationale: "Prêmio de crédito dentro do FGC" },
        { assetId: "BR-LCI-95", weight: 0.08, rationale: "Isenção de IR" },
        { assetId: "BR-BOVA11", weight: 0.12, rationale: "Bolsa brasileira diversificada" },
        { assetId: "BR-ITUB4", weight: 0.05, rationale: "Bancos" },
        { assetId: "BR-WEGE3", weight: 0.05, rationale: "Exportadora industrial" },
        { assetId: "BR-HGLG11", weight: 0.07, rationale: "Renda imobiliária" },
        { assetId: "US-VOO", weight: 0.15, rationale: "Diversificação internacional" },
        { assetId: "CR-BTC", weight: 0.03, rationale: "Exposição pequena a cripto" },
        { assetId: "CR-USDT", weight: 0.02, rationale: "Liquidez em dólar on-chain" },
        { assetId: "BR-RWA-RECEB", weight: 0.03, rationale: "Crédito tokenizado" },
      ],
    });
    // Size positions from the target weights at current demo prices, with slight drift
    // and a cost basis below the current price so the demo has plausible P&L.
    const holdingDays: Record<string, number> = { "BR-TD-SELIC-2029": 400, "BR-TD-IPCA-2035": 300, "BR-CDB-MED-115": 200, "BR-LCI-95": 150, "BR-RWA-RECEB": 60 };
    const drift: Record<string, number> = { "BR-BOVA11": 1.1, "US-VOO": 1.12, "CR-BTC": 1.25, "BR-TD-SELIC-2029": 0.85 };
    const prices = await tx.query<{ asset_id: string; close: number }>(`select distinct on (asset_id) asset_id, close from asset_prices where is_demo order by asset_id, date desc`);
    const last = new Map(prices.map((p) => [p.asset_id, p.close]));
    const usdbrl = 5.42;
    const targets = await tx.query<{ asset_id: string; weight: number }>(`select asset_id, weight from target_allocations where portfolio_id = $1`, [pf]);
    for (const t of targets) {
      const spec = CATALOG_BY_ID.get(t.asset_id)!;
      const valueBRL = DEMO_PROFILE.amount * t.weight * (drift[t.asset_id] ?? 1);
      const local = spec.currency === "USD" ? valueBRL / usdbrl : valueBRL;
      if (spec.pricing === "accrual") {
        await addPosition(tx, userId, { portfolioId: pf, assetId: t.asset_id, quantity: Math.round(local / 1.08), avgPrice: 1, acquiredAt: d(holdingDays[t.asset_id] ?? 180), notes: "Posição fictícia (demo)" });
      } else {
        const px = last.get(t.asset_id)!;
        const qty = Math.round((local / px) * 1e6) / 1e6;
        await addPosition(tx, userId, { portfolioId: pf, assetId: t.asset_id, quantity: qty, avgPrice: Math.round(px * 0.9 * 1e4) / 1e4, acquiredAt: d(365), notes: "Posição fictícia (demo)" });
      }
    }
  });
  // Baseline run so the next run can compare against stored snapshots.
  await runMonitoring(userId, "manual", { refresh: false });
}
