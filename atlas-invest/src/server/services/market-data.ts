// MarketDataService — single entry point for prices, macro indicators and data
// source status. Real and demo observations are stored side by side with an
// explicit is_demo flag and are never mixed inside one series.

import { CATALOG, CATALOG_BY_ID } from "@/domain/catalog";
import { addDays, classifyFreshness, lastTradingDayOnOrBefore, toISODate } from "@/domain/calendar";
import type { AssetMarketData } from "@/domain/analytics";
import { DEMO_MACRO, DEMO_SCENARIOS, demoMarketOf, extendDemoSeries, generateDemoSeries } from "@/domain/demo-market";
import type { AssetSpec, DataOrigin, MacroSnapshot, PricePoint } from "@/domain/types";
import { DEMO_SOURCE, MACRO_PROVIDERS, PRICE_PROVIDERS } from "@/server/providers";
import { uuid, withSystem, type Tx } from "@/server/db";

export function todayISO(): string {
  return process.env.ATLAS_TODAY || toISODate(new Date());
}

const HISTORY_YEARS = 3;

export async function syncCatalog(tx: Tx): Promise<void> {
  await tx.query(
    `insert into data_sources(id, name, kind, is_demo, url, license_note, configured, status)
     values ($1,$2,$3,true,$4,$5,true,'ok'), ('demo_events','Atlas — eventos de demonstração','events',true,null,'Eventos SIMULADOS criados no laboratório de demonstração.',true,'ok')
     on conflict (id) do update set name = excluded.name, license_note = excluded.license_note`,
    [DEMO_SOURCE.id, DEMO_SOURCE.name, DEMO_SOURCE.kind, DEMO_SOURCE.url, DEMO_SOURCE.licenseNote],
  );
  for (const p of [...MACRO_PROVIDERS, ...PRICE_PROVIDERS]) {
    await tx.query(
      `insert into data_sources(id, name, kind, is_demo, url, license_note, configured)
       values ($1,$2,$3,false,$4,$5,$6)
       on conflict (id) do update set name = excluded.name, url = excluded.url, license_note = excluded.license_note, configured = excluded.configured`,
      [p.id, p.name, p.kind, p.url, p.licenseNote, p.configured()],
    );
  }
  for (const a of CATALOG) {
    await tx.query(
      `insert into assets(id, symbol, name, asset_class, market, currency, issuer, sector, country, spec)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (id) do update set symbol=excluded.symbol, name=excluded.name, asset_class=excluded.asset_class, market=excluded.market,
         currency=excluded.currency, issuer=excluded.issuer, sector=excluded.sector, country=excluded.country, spec=excluded.spec, updated_at=now()`,
      [a.id, a.symbol, a.name, a.assetClass, a.market, a.currency, a.issuer, a.sector, a.country, JSON.stringify(a)],
    );
  }
}

async function insertPrices(tx: Tx, assetId: string, points: PricePoint[], sourceId: string, isDemo: boolean): Promise<void> {
  if (points.length === 0) return;
  for (let i = 0; i < points.length; i += 1000) {
    const chunk = points.slice(i, i + 1000);
    await tx.query(
      `insert into asset_prices(asset_id, date, close, source_id, is_demo)
       select $1, d, c, $2, $3 from unnest($4::date[], $5::float8[]) as t(d, c)
       on conflict (asset_id, is_demo, date) do update set close = excluded.close, source_id = excluded.source_id, fetched_at = now()`,
      [assetId, sourceId, isDemo, chunk.map((p) => p.date), chunk.map((p) => p.close)],
    );
  }
}

/** Extend demo price series and demo macro levels up to `today`. Idempotent. */
export async function ensureDemoData(tx: Tx, today = todayISO()): Promise<void> {
  const latest = await tx.query<{ asset_id: string; date: string; close: number }>(
    `select distinct on (asset_id) asset_id, date, close from asset_prices where is_demo order by asset_id, date desc`,
  );
  const byAsset = new Map(latest.map((r) => [r.asset_id, r]));
  for (const spec of CATALOG) {
    if (spec.pricing !== "quoted") continue;
    const last = byAsset.get(spec.id);
    const points = last
      ? extendDemoSeries(spec, { date: last.date, close: last.close }, today)
      : generateDemoSeries(spec, addDays(today, -Math.round(HISTORY_YEARS * 365.25)), today);
    await insertPrices(tx, spec.id, points, "demo", true);
  }
  const macroLatest = await tx.query<{ code: string; date: string; value: number }>(
    `select distinct on (code) code, date, value from macro_indicators where is_demo order by code, date desc`,
  );
  const m = new Map(macroLatest.map((r) => [r.code, r]));
  for (const d of DEMO_MACRO) {
    const last = m.get(d.code);
    if (!last) {
      await tx.query(`insert into macro_indicators(code, date, value, source_id, is_demo) values ($1,$2,$3,'demo',true)`, [d.code, addDays(today, -1), d.value]);
      await tx.query(`insert into macro_indicators(code, date, value, source_id, is_demo) values ($1,$2,$3,'demo',true)`, [d.code, today, d.value]);
    } else if (last.date < today) {
      await tx.query(`insert into macro_indicators(code, date, value, source_id, is_demo) values ($1,$2,$3,'demo',true) on conflict do nothing`, [d.code, today, last.value]);
    }
  }
}

function cacheMinutes(): number {
  return Number(process.env.MARKET_CACHE_MINUTES ?? 60);
}

export interface RefreshReport {
  source: string;
  status: "ok" | "error" | "skipped_cache" | "not_configured";
  detail: string;
}

/** Pull from every configured live provider (respecting cache), then extend demo data. */
export async function refreshMarketData(opts: { force?: boolean } = {}): Promise<RefreshReport[]> {
  const report: RefreshReport[] = [];
  const sources = await withSystem((tx) => tx.query<{ id: string; last_success_at: string | null; last_attempt_at: string | null }>(`select id, last_success_at, last_attempt_at from data_sources`));
  const meta = new Map(sources.map((s) => [s.id, s]));
  const fresh = (id: string) => {
    const s = meta.get(id);
    const t = s?.last_attempt_at ? Date.parse(s.last_attempt_at) : 0;
    return !opts.force && Date.now() - t < cacheMinutes() * 60000;
  };

  for (const p of MACRO_PROVIDERS) {
    if (!p.configured()) {
      report.push({ source: p.id, status: "not_configured", detail: "Modo de dados demo ou provedor desabilitado." });
      continue;
    }
    if (fresh(p.id)) {
      report.push({ source: p.id, status: "skipped_cache", detail: "Dentro da janela de cache." });
      continue;
    }
    try {
      const obs = await p.fetchMacro();
      await withSystem(async (tx) => {
        for (const o of obs) {
          await tx.query(
            `insert into macro_indicators(code, date, value, source_id, is_demo) values ($1,$2,$3,$4,false)
             on conflict (code, is_demo, date) do update set value = excluded.value, fetched_at = now()`,
            [o.code, o.date, o.value, p.id],
          );
        }
        await tx.query(`update data_sources set status='ok', last_success_at=now(), last_attempt_at=now(), last_error=null where id=$1`, [p.id]);
      });
      report.push({ source: p.id, status: "ok", detail: `${obs.length} observações.` });
    } catch (e) {
      await markError(p.id, e);
      report.push({ source: p.id, status: "error", detail: errMsg(e) });
    }
  }

  for (const p of PRICE_PROVIDERS) {
    if (!p.configured()) {
      report.push({ source: p.id, status: "not_configured", detail: "Sem credencial configurada ou modo demo." });
      continue;
    }
    if (fresh(p.id)) {
      report.push({ source: p.id, status: "skipped_cache", detail: "Dentro da janela de cache." });
      continue;
    }
    const specs = CATALOG.filter((s) => p.supports(s));
    let ok = 0;
    const errors: string[] = [];
    for (const spec of specs) {
      try {
        const pts = await p.fetchHistory(spec);
        await withSystem((tx) => insertPrices(tx, spec.id, pts, p.id, false));
        ok++;
      } catch (e) {
        errors.push(`${spec.symbol}: ${errMsg(e)}`);
        if (errors.length >= 2 && ok === 0) break; // provider is down; don't hammer it
      }
    }
    if (ok > 0) {
      await withSystem((tx) => tx.query(`update data_sources set status=$2, last_success_at=now(), last_attempt_at=now(), last_error=$3 where id=$1`, [p.id, errors.length ? "partial" : "ok", errors.join("; ") || null]));
      report.push({ source: p.id, status: "ok", detail: `${ok}/${specs.length} ativos atualizados.${errors.length ? ` Falhas: ${errors.join("; ")}` : ""}` });
    } else {
      await markError(p.id, new Error(errors.join("; ") || "sem dados"));
      report.push({ source: p.id, status: "error", detail: errors.join("; ") });
    }
  }

  await withSystem((tx) => ensureDemoData(tx));
  return report;
}

function errMsg(e: unknown): string {
  const err = e as { message?: string; cause?: { code?: string; message?: string } };
  return [err?.message, err?.cause?.code ?? err?.cause?.message].filter(Boolean).join(" — ") || String(e);
}

async function markError(id: string, e: unknown) {
  await withSystem((tx) => tx.query(`update data_sources set status='error', last_attempt_at=now(), last_error=$2 where id=$1`, [id, errMsg(e).slice(0, 500)]));
}

const MACRO_CODES = ["CDI", "SELIC", "IPCA12M", "USDBRL", "UST3M", "UST10Y"] as const;
const REAL_MACRO_MAX_AGE_DAYS = 10;

/** Latest macro levels, preferring real observations when they are recent. */
export async function getMacroSnapshot(tx: Tx, today = todayISO()): Promise<MacroSnapshot> {
  const rows = await tx.query<{ code: string; is_demo: boolean; date: string; value: number }>(
    `select distinct on (code, is_demo) code, is_demo, date, value from macro_indicators order by code, is_demo, date desc`,
  );
  const origin: Record<string, DataOrigin> = {};
  const values: Record<string, number> = {};
  let asOf = "";
  for (const code of MACRO_CODES) {
    const real = rows.find((r) => r.code === code && !r.is_demo);
    const demo = rows.find((r) => r.code === code && r.is_demo);
    const useReal = real && real.date >= addDays(today, -REAL_MACRO_MAX_AGE_DAYS);
    const r = useReal ? real : demo ?? real;
    const fallback = DEMO_MACRO.find((d) => d.code === code)!.value;
    values[code] = r?.value ?? fallback;
    origin[code] = useReal ? "real" : "demo";
    if (r && r.date > asOf) asOf = r.date;
  }
  return {
    cdi: values.CDI, selic: values.SELIC, ipca12m: values.IPCA12M, usdbrl: values.USDBRL, ust3m: values.UST3M, ust10y: values.UST10Y,
    asOf: asOf || today, origin,
  };
}

export interface SourceRow {
  id: string;
  name: string;
  kind: string;
  is_demo: boolean;
  url: string | null;
  license_note: string | null;
  configured: boolean;
  status: string;
  last_success_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
}

export async function listSources(tx: Tx): Promise<SourceRow[]> {
  return tx.query<SourceRow>(`select * from data_sources order by is_demo, id`);
}

/** Load price series and freshness status for the given assets. */
export async function getMarketData(tx: Tx, assetIds: string[], macro: MacroSnapshot, today = todayISO()): Promise<Map<string, AssetMarketData>> {
  const since = addDays(today, -Math.round(HISTORY_YEARS * 365.25) - 5);
  const rows = await tx.query<{ asset_id: string; date: string; close: number; is_demo: boolean; source_id: string; fetched_at: string }>(
    `select asset_id, date, close, is_demo, source_id, fetched_at from asset_prices where asset_id = any($1) and date >= $2 order by asset_id, is_demo, date`,
    [assetIds, since],
  );
  const sources = new Map((await listSources(tx)).map((s) => [s.id, s]));
  const out = new Map<string, AssetMarketData>();
  for (const id of assetIds) {
    const spec = CATALOG_BY_ID.get(id);
    if (!spec) continue;
    if (spec.pricing === "accrual") {
      out.set(id, accrualMarketData(spec, macro, today));
      continue;
    }
    const mine = rows.filter((r) => r.asset_id === id);
    const real = mine.filter((r) => !r.is_demo);
    const useReal = real.length > 0;
    const series = useReal ? real : mine.filter((r) => r.is_demo);
    const last = series[series.length - 1];
    const sourceId = last?.source_id ?? (useReal ? spec.liveProvider?.provider : "demo") ?? "demo";
    const src = sources.get(sourceId);
    // When live data is configured but failing, demo fallback is flagged as such.
    const sourceAvailable = useReal ? src?.status !== "error" : true;
    const status = classifyFreshness(last?.date ?? null, today, demoMarketOf(spec), sourceAvailable);
    out.set(id, {
      prices: series.map((r) => ({ date: r.date, close: r.close })),
      origin: last ? (useReal ? "real" : "demo") : null,
      sourceName: src?.name ?? null,
      lastUpdated: last?.fetched_at ?? null,
      status,
    });
  }
  return out;
}

function accrualMarketData(spec: AssetSpec, macro: MacroSnapshot, today: string): AssetMarketData {
  const fixed = spec.yield?.type === "prefixed" || spec.yield?.type === "usd_fixed";
  const code = spec.currency === "USD" ? "UST3M" : spec.yield?.type === "ipca_spread" ? "IPCA12M" : spec.yield?.type === "selic_spread" ? "SELIC" : "CDI";
  // Contract terms in the catalog are illustrative, so fixed-rate instruments are flagged as demo.
  const origin: DataOrigin = fixed ? "demo" : macro.origin[code];
  const sourceName = fixed
    ? "Taxa cadastral ilustrativa (catálogo Atlas)"
    : origin === "demo"
      ? `${DEMO_SOURCE.name} (indexador ${code})`
      : spec.currency === "USD" ? "U.S. Treasury (indexador T-Bill 3M)" : `Banco Central do Brasil (indexador ${code})`;
  const stale = macro.asOf < addDays(lastTradingDayOnOrBefore(today, spec.currency === "USD" ? "US" : "BR"), -5);
  return { prices: [], origin, sourceName, lastUpdated: macro.asOf, status: stale ? "stale" : "ok" };
}

/** Apply a demo lab scenario: shocks demo prices/macro and records demo events. */
export async function applyDemoScenario(tx: Tx, scenarioId: string, today = todayISO()): Promise<{ label: string; changes: string[] }> {
  const sc = DEMO_SCENARIOS.find((s) => s.id === scenarioId);
  if (!sc) throw new Error("Cenário desconhecido");
  await ensureDemoData(tx, today);
  const changes: string[] = [];
  for (const [assetId, shock] of Object.entries(sc.priceShocks)) {
    const spec = CATALOG_BY_ID.get(assetId);
    if (!spec) continue;
    const date = lastTradingDayOnOrBefore(today, demoMarketOf(spec));
    const [prev] = await tx.query<{ close: number }>(`select close from asset_prices where asset_id=$1 and is_demo and date < $2 order by date desc limit 1`, [assetId, date]);
    const [cur] = await tx.query<{ close: number }>(`select close from asset_prices where asset_id=$1 and is_demo and date = $2`, [assetId, date]);
    const basis = cur?.close ?? prev?.close;
    if (!basis) continue;
    const next = spec.demo.peg ? spec.demo.peg * (1 + shock) : basis * (1 + shock);
    await insertPrices(tx, assetId, [{ date, close: Math.round(next * 1e6) / 1e6 }], "demo", true);
    changes.push(`${spec.symbol}: ${(shock * 100).toFixed(1)}% (${date})`);
  }
  for (const [code, delta] of Object.entries(sc.macroShocks ?? {})) {
    const [last] = await tx.query<{ value: number }>(`select value from macro_indicators where code=$1 and is_demo order by date desc limit 1`, [code]);
    const base = last?.value ?? DEMO_MACRO.find((d) => d.code === code)!.value;
    const value = code === "USDBRL" ? base * (1 + delta) : base + delta;
    await tx.query(
      `insert into macro_indicators(code, date, value, source_id, is_demo) values ($1,$2,$3,'demo',true)
       on conflict (code, is_demo, date) do update set value = excluded.value, fetched_at = now()`,
      [code, today, value],
    );
    changes.push(`${code}: ${base.toFixed(4)} → ${value.toFixed(4)}`);
  }
  for (const e of sc.events ?? []) {
    await tx.query(
      `insert into market_events(id, asset_id, event_type, severity, title, description, occurred_at, source_id, is_demo)
       values ($1,$2,$3,$4,$5,$6,now(),'demo_events',true)`,
      [uuid(), e.assetId, e.type, e.severity, e.title, e.description],
    );
    changes.push(`Evento: ${e.title}`);
  }
  return { label: sc.label, changes };
}
