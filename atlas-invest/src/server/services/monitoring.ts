// MonitoringService — manual and scheduled portfolio checks.

import { ALERT_RULES_VERSION, dedupe, evaluateRules, type AlertCandidate, type MonitorAssetState, type MonitorContext, type MonitorEvent } from "@/domain/alerts";
import { addDays, DATA_STATUS_LABEL, holidayCoverage, isTradingDay, type DataStatus } from "@/domain/calendar";
import { annualizedVolatility } from "@/domain/finance";
import { demoMarketOf } from "@/domain/demo-market";
import type { MacroSnapshot, RiskCategory, Severity } from "@/domain/types";
import { uuid, withSystem, withUser, type Tx } from "@/server/db";
import { audit } from "./audit";
import { persistRiskMetrics, type AnalyzedAsset } from "./discovery";
import { listSources, refreshMarketData, todayISO, type RefreshReport } from "./market-data";
import { dispatchAlerts, type AlertMessage } from "./notifications";
import { listPortfolios, portfolioView } from "./portfolio";
import { getPreferences, getProfile } from "./profile";

export type Trigger = "manual" | "scheduled" | "api";

export interface RunResult {
  runId: string | null;
  status: "ok" | "partial" | "error" | "skipped";
  alertsCreated: number;
  alertsSuppressed: number;
  message: string;
}

const FIXED_CLASSES = new Set(["treasury_br", "treasury_us", "bank_fixed_income", "corporate_bond", "fund"]);

export async function runMonitoring(userId: string, trigger: Trigger, opts: { refresh?: boolean } = {}): Promise<RunResult> {
  let refresh: RefreshReport[] = [];
  if (opts.refresh !== false) {
    try {
      refresh = await refreshMarketData();
    } catch (e) {
      refresh = [{ source: "all", status: "error", detail: (e as Error).message }];
    }
  }
  const today = todayISO();
  const analyzedAt = new Date().toISOString();
  const touched = new Map<string, AnalyzedAsset>();

  const outcome = await withUser(userId, async (tx) => {
    const profile = await getProfile(tx);
    if (!profile) return { runId: null, status: "skipped" as const, alertsCreated: 0, alertsSuppressed: 0, message: "Perfil de investimento não configurado.", messages: [] as AlertMessage[], base: "BRL" as const };
    const { thresholds } = await getPreferences(tx);
    const runId = uuid();
    await tx.query(`insert into monitoring_runs(id, user_id, trigger, rules_version) values ($1,$2,$3,$4)`, [runId, userId, trigger, ALERT_RULES_VERSION]);

    const portfolios = await listPortfolios(tx);
    const created: { id: string; c: AlertCandidate; portfolioName: string }[] = [];
    let suppressed = 0;
    const statusCounts: Record<string, number> = {};
    const perPortfolio: { id: string; name: string; value: number; risk: number; alerts: number; skipped?: string }[] = [];
    let anyDemo = false;

    for (const p of portfolios) {
      const view = await portfolioView(tx, p.id, profile.derived.horizonYears, false);
      if (!view?.analytics) {
        perPortfolio.push({ id: p.id, name: p.name, value: 0, risk: 0, alerts: 0, skipped: "Sem posições" });
        continue;
      }
      const an = view.analytics;
      for (const a of view.assets.values()) touched.set(a.spec.id, a);

      const [prevPf] = await tx.query<{ run_id: string; total_value: number; risk_score: number; macro: MacroSnapshot; created_at: string }>(
        `select run_id, total_value, risk_score, macro, created_at from portfolio_snapshots where portfolio_id = $1 order by created_at desc limit 1`,
        [p.id],
      );
      const prevSnaps = prevPf
        ? await tx.query<{ asset_id: string; price: number | null; price_date: string | null; risk_score: number; risk_category: RiskCategory }>(
            `select asset_id, price, price_date, risk_score, risk_category from monitoring_snapshots where run_id = $1 and portfolio_id = $2`,
            [prevPf.run_id, p.id],
          )
        : [];
      const prevMap = new Map(prevSnaps.map((s) => [s.asset_id, s]));
      const [peak] = await tx.query<{ peak: number | null }>(`select max(total_value) as peak from portfolio_snapshots where portfolio_id = $1`, [p.id]);

      const eventsSince = prevPf?.created_at ?? addDays(today, -7);
      const events = await tx.query<{ id: string; asset_id: string | null; event_type: string; severity: Severity; title: string; description: string; occurred_at: string; is_demo: boolean; source: string }>(
        `select e.id, e.asset_id, e.event_type, e.severity, e.title, e.description, e.occurred_at, e.is_demo, s.name as source
         from market_events e join data_sources s on s.id = e.source_id where e.created_at > $1 order by e.occurred_at`,
        [eventsSince],
      );

      const assets: MonitorAssetState[] = an.holdings.map((h) => {
        const a = view.assets.get(h.assetId)!;
        const prices = a.md.prices;
        const last = prices[prices.length - 1];
        const prev = prevMap.get(h.assetId);
        const prevClose = prices[prices.length - 2];
        const isQuoted = a.spec.pricing === "quoted";
        statusCounts[a.md.status] = (statusCounts[a.md.status] ?? 0) + 1;
        if (a.md.origin !== "real") anyDemo = true;
        return {
          assetId: h.assetId, symbol: a.spec.symbol, name: a.spec.name, assetClass: a.spec.assetClass, weight: h.weight, value: h.value, targetWeight: h.targetWeight,
          price: isQuoted ? last?.close ?? null : null,
          priceDate: isQuoted ? last?.date ?? null : null,
          prevPrice: isQuoted ? (prev ? prev.price : prevClose?.close ?? null) : null,
          prevPriceDate: isQuoted ? (prev ? prev.price_date : prevClose?.date ?? null) : null,
          prevSource: prev ? "last_run" : prevClose ? "previous_close" : null,
          status: a.md.status, origin: a.md.origin, sourceName: a.md.sourceName,
          riskScore: a.analytics.risk.score, prevRiskScore: prev?.risk_score ?? null, riskCategory: a.analytics.risk.category, prevRiskCategory: prev?.risk_category ?? null,
          recentVol: isQuoted && prices.length > 25 ? annualizedVolatility(prices.slice(-21).map((x) => x.close), demoMarketOf(a.spec) === "GLOBAL" ? 365 : 252) : null,
          longVol: isQuoted && prices.length > 200 ? annualizedVolatility(prices.slice(-252).map((x) => x.close), demoMarketOf(a.spec) === "GLOBAL" ? 365 : 252) : null,
          peg: a.spec.demo.peg,
        };
      });

      const ctx: MonitorContext = {
        portfolioId: p.id, portfolioName: p.name, baseCurrency: view.portfolio.base_currency, totalValue: an.totalValue,
        profile: { label: profile.derived.label, maxRiskScore: profile.derived.maxRiskScore, maxDrawdown: profile.derived.maxDrawdown, maxCryptoWeight: profile.derived.maxCryptoWeight, objective: profile.answers.objective },
        portfolioRisk: an.risk.score, prevPortfolioRisk: prevPf?.risk_score ?? null, peakValue: peak?.peak ?? null,
        macro: { current: view.macro, previous: prevPf?.macro ?? null },
        events: events.map<MonitorEvent>((e) => ({ id: e.id, assetId: e.asset_id, type: e.event_type, severity: e.severity, title: e.title, description: e.description, occurredAt: e.occurred_at, isDemo: e.is_demo, sourceName: e.source })),
        fxExposure: an.fxExposure,
        fixedIncomeWeight: an.holdings.filter((h) => FIXED_CLASSES.has(h.assetClass)).reduce((s, h) => s + h.weight, 0),
        assets, analyzedAt,
      };
      const candidates = evaluateRules(ctx, thresholds);
      const recent = await tx.query<{ fingerprint: string; severity: Severity; last_seen_at: string }>(
        `select distinct on (fingerprint) fingerprint, severity, last_seen_at from alerts where portfolio_id = $1 order by fingerprint, last_seen_at desc`,
        [p.id],
      );
      const { create, repeated } = dedupe(candidates, recent.map((r) => ({ fingerprint: r.fingerprint, severity: r.severity, lastSeenAt: r.last_seen_at })), new Date(), thresholds.cooldownHours);
      for (const c of repeated) {
        await tx.query(`update alerts set occurrences = occurrences + 1, last_seen_at = now() where id = (select id from alerts where portfolio_id = $1 and fingerprint = $2 order by last_seen_at desc limit 1)`, [p.id, c.fingerprint]);
      }
      suppressed += repeated.length;
      for (const c of create) {
        const id = uuid();
        const demo = c.evidence.some((e) => e.isDemo) || (c.affected.assets.length > 0 && c.affected.assets.some((aid) => view.assets.get(aid)?.md.origin !== "real"));
        await tx.query(
          `insert into alerts(id, user_id, portfolio_id, run_id, rule, fingerprint, severity, title, what_changed, why_matters, affected, impact, suggested_action, evidence, uses_demo_data, analyzed_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [id, userId, p.id, runId, c.rule, c.fingerprint, c.severity, c.title, c.whatChanged, c.whyMatters, JSON.stringify(c.affected), JSON.stringify(c.impact), c.suggestedAction, JSON.stringify(c.evidence), demo, analyzedAt],
        );
        created.push({ id, c, portfolioName: p.name });
      }

      for (const h of an.holdings) {
        const a = view.assets.get(h.assetId)!;
        const last = a.md.prices[a.md.prices.length - 1];
        await tx.query(
          `insert into monitoring_snapshots(run_id, user_id, portfolio_id, asset_id, price, price_date, value_base, weight, risk_score, risk_category, data_status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [runId, userId, p.id, h.assetId, a.spec.pricing === "quoted" ? last?.close ?? null : null, a.spec.pricing === "quoted" ? last?.date ?? null : null, h.value, h.weight, a.analytics.risk.score, a.analytics.risk.category, a.md.status],
        );
      }
      await tx.query(`insert into portfolio_snapshots(run_id, user_id, portfolio_id, total_value, risk_score, macro) values ($1,$2,$3,$4,$5,$6)`, [runId, userId, p.id, an.totalValue, an.risk.score, JSON.stringify(view.macro)]);
      perPortfolio.push({ id: p.id, name: p.name, value: an.totalValue, risk: an.risk.score, alerts: create.length });
    }

    const sources = await listSources(tx);
    const marketStatus = {
      date: today,
      markets: (["BR", "US", "GLOBAL"] as const).map((m) => ({ market: m, tradingDay: isTradingDay(today, m), holidayCalendar: m === "GLOBAL" || holidayCoverage(today) })),
      dataStatus: Object.fromEntries(Object.entries(statusCounts).map(([k, v]) => [DATA_STATUS_LABEL[k as DataStatus] ?? k, v])),
      sources: sources.filter((s) => !s.is_demo).map((s) => ({ id: s.id, name: s.name, configured: s.configured, status: s.status, lastError: s.last_error, lastSuccess: s.last_success_at })),
      refresh,
      usesDemoData: anyDemo,
    };
    const anySourceError = sources.some((s) => s.configured && s.status === "error");
    const status = anySourceError ? "partial" : "ok";
    await tx.query(
      `update monitoring_runs set finished_at = now(), status = $2, market_status = $3, summary = $4, alerts_created = $5, alerts_suppressed = $6 where id = $1`,
      [runId, status, JSON.stringify(marketStatus), JSON.stringify({ portfolios: perPortfolio }), created.length, suppressed],
    );
    await audit(tx, userId, trigger === "scheduled" ? "system" : "user", "monitoring.run", "monitoring_run", runId, { trigger, alerts: created.length, suppressed });
    const messages: AlertMessage[] = created.map(({ id, c, portfolioName }) => ({ alertId: id, severity: c.severity, title: c.title, body: `${portfolioName}: ${c.whatChanged} Ação sugerida: ${c.suggestedAction}`, url: `/alerts/${id}` }));
    return {
      runId, status: status as "ok" | "partial", alertsCreated: created.length, alertsSuppressed: suppressed, messages, base: profile.answers.baseCurrency,
      message: `${created.length} alerta(s) novo(s), ${suppressed} repetido(s) suprimido(s) em ${perPortfolio.length} portfólio(s).${anySourceError ? " Algumas fontes reais estão indisponíveis; dados de demonstração usados como fallback." : ""}`,
    };
  });

  await dispatchAlerts(userId, outcome.messages);
  if (touched.size) await persistRiskMetrics(touched, outcome.base).catch(() => {});
  return { runId: outcome.runId, status: outcome.status, alertsCreated: outcome.alertsCreated, alertsSuppressed: outcome.alertsSuppressed, message: outcome.message };
}

/** Scheduled run across every user with a profile. */
export async function runScheduledForAll(): Promise<{ users: number; alerts: number }> {
  await refreshMarketData().catch(() => []);
  const users = await withSystem((tx) => tx.query<{ user_id: string }>(`select user_id from investment_profiles`));
  let alerts = 0;
  for (const u of users) {
    try {
      const r = await runMonitoring(u.user_id, "scheduled", { refresh: false });
      alerts += r.alertsCreated;
    } catch (e) {
      console.error("[monitor] falha para usuário", u.user_id, e);
    }
  }
  await withSystem((tx) =>
    tx.query(`insert into scheduler_state(key, value) values ('daily_monitor', $1) on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify({ lastRunDate: todayISO(), at: new Date().toISOString(), users: users.length, alerts })]),
  );
  return { users: users.length, alerts };
}

export interface RunRow {
  id: string;
  trigger: Trigger;
  started_at: string;
  finished_at: string | null;
  status: string;
  market_status: Record<string, unknown>;
  summary: { portfolios?: { id: string; name: string; value: number; risk: number; alerts: number; skipped?: string }[] };
  alerts_created: number;
  alerts_suppressed: number;
  rules_version: string;
}

export async function listRuns(tx: Tx, limit = 30): Promise<RunRow[]> {
  return tx.query<RunRow>(`select * from monitoring_runs order by started_at desc limit $1`, [limit]);
}

export interface AlertRow {
  id: string;
  portfolio_id: string | null;
  portfolio_name: string | null;
  run_id: string | null;
  rule: string;
  severity: Severity;
  title: string;
  what_changed: string;
  why_matters: string;
  affected: { assets: string[]; objectives: string[] };
  impact: { portfolioPct: number | null; amount: number | null; description: string };
  suggested_action: string;
  evidence: { label: string; value: string; source: string; asOf: string | null; isDemo?: boolean }[];
  uses_demo_data: boolean;
  analyzed_at: string;
  status: "open" | "acknowledged" | "resolved";
  occurrences: number;
  last_seen_at: string;
  read_at: string | null;
  created_at: string;
}

export async function listAlerts(tx: Tx, filter: { severity?: Severity; status?: string; portfolioId?: string } = {}, limit = 200): Promise<AlertRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.severity) {
    params.push(filter.severity);
    where.push(`a.severity = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    where.push(`a.status = $${params.length}`);
  }
  if (filter.portfolioId) {
    params.push(filter.portfolioId);
    where.push(`a.portfolio_id = $${params.length}`);
  }
  params.push(limit);
  return tx.query<AlertRow>(
    `select a.*, p.name as portfolio_name from alerts a left join portfolios p on p.id = a.portfolio_id ${where.length ? `where ${where.join(" and ")}` : ""}
     order by a.created_at desc, case a.severity when 'critical' then 0 when 'attention' then 1 else 2 end limit $${params.length}`,
    params,
  );
}

export async function getAlert(tx: Tx, id: string): Promise<AlertRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [a] = await tx.query<AlertRow>(`select a.*, p.name as portfolio_name from alerts a left join portfolios p on p.id = a.portfolio_id where a.id = $1`, [id]);
  return a ?? null;
}

export async function setAlertStatus(tx: Tx, userId: string, id: string, status: "open" | "acknowledged" | "resolved"): Promise<void> {
  await tx.query(`update alerts set status = $2, read_at = coalesce(read_at, now()) where id = $1`, [id, status]);
  await tx.query(`update notifications set read_at = coalesce(read_at, now()) where alert_id = $1`, [id]);
  await audit(tx, userId, "user", `alert.${status}`, "alert", id);
}
