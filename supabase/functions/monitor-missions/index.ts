// Scheduled worker: invoked every minute by pg_cron (see migrations). Runs every
// mission whose next_check_at is due, in its own mode (demo or live).

import { runMissionCycle } from "../_shared/engine/engine.ts";
import { progressDemoDeposits } from "../_shared/engine/service.ts";
import { errorMessage } from "../_shared/engine/util.ts";
import { buildRuntime } from "../_shared/runtime.ts";

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return new Response("Forbidden", { status: 403 });

  const rt = await buildRuntime();
  const started = Date.now();
  const results: unknown[] = [];

  await progressDemoDeposits(rt.store, new Date().toISOString()).catch((e) => console.error("deposits", errorMessage(e)));

  const due = await rt.store.listDueMissions(new Date().toISOString(), 25);
  for (const mission of due) {
    if (Date.now() - started > 45000) break; // stay within the invocation budget
    try {
      results.push(await runMissionCycle(mission.id, rt.depsFor(mission.mode)));
    } catch (err) {
      // Never log passenger or payment data here — only identifiers and messages.
      console.error("mission", mission.id, errorMessage(err));
      await rt.store.updateMission(mission.id, { lastError: errorMessage(err) }).catch(() => {});
      results.push({ missionId: mission.id, action: "error", message: errorMessage(err) });
    }
  }
  return Response.json({ processed: results.length, results });
});
