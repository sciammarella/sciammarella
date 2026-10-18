// Runs the daily monitor for every user with a profile (for system cron).
// With PGlite, stop the Next.js server first (the embedded database is single-process);
// alternatively call POST /api/cron/monitor on the running server.
import { ensureReady } from "@/server/bootstrap";
import { resetDriverForTests } from "@/server/db";
import { runScheduledForAll } from "@/server/services/monitoring";

await ensureReady();
const r = await runScheduledForAll();
console.log(`Monitoramento concluído: ${r.users} usuário(s), ${r.alerts} alerta(s) novo(s).`);
await resetDriverForTests();
process.exit(0);
