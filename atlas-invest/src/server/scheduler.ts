// In-process daily scheduler. Checks once a minute; runs the daily monitor once
// per UTC day after MONITOR_DAILY_UTC. For serverless deployments, disable it
// (MONITOR_SCHEDULER_ENABLED=false) and call /api/cron/monitor from a cron service.

import { withSystem } from "@/server/db";
import { ensureReady } from "./bootstrap";
import { runScheduledForAll } from "./services/monitoring";
import { todayISO } from "./services/market-data";

const g = globalThis as unknown as { __atlasScheduler?: NodeJS.Timeout; __atlasSchedulerBusy?: boolean };

export function dueNow(now: Date, dailyUtc: string, lastRunDate: string | null, today: string): boolean {
  const [h, m] = dailyUtc.split(":").map(Number);
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minutes >= h * 60 + (m || 0) && lastRunDate !== today;
}

async function tick(): Promise<void> {
  if (g.__atlasSchedulerBusy) return;
  g.__atlasSchedulerBusy = true;
  try {
    await ensureReady();
    const [state] = await withSystem((tx) => tx.query<{ value: { lastRunDate?: string } }>(`select value from scheduler_state where key = 'daily_monitor'`));
    if (dueNow(new Date(), process.env.MONITOR_DAILY_UTC ?? "21:30", state?.value.lastRunDate ?? null, todayISO())) {
      const r = await runScheduledForAll();
      console.log(`[scheduler] monitoramento diário concluído: ${r.users} usuário(s), ${r.alerts} alerta(s).`);
    }
  } catch (e) {
    console.error("[scheduler] erro", e);
  } finally {
    g.__atlasSchedulerBusy = false;
  }
}

export function startScheduler(): void {
  if (g.__atlasScheduler || process.env.MONITOR_SCHEDULER_ENABLED === "false") return;
  g.__atlasScheduler = setInterval(tick, 60_000);
  g.__atlasScheduler.unref?.();
  setTimeout(tick, 5_000).unref?.();
  console.log(`[scheduler] ativo — execução diária às ${process.env.MONITOR_DAILY_UTC ?? "21:30"} UTC`);
}
