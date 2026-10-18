// Syncs the asset catalog, generates demo market data and creates the demo account.
import { DEMO_EMAIL, DEMO_PASSWORD, ensureReady } from "@/server/bootstrap";
import { resetDriverForTests } from "@/server/db";

await ensureReady();
console.log(`Catálogo e dados de demonstração prontos. Conta demo: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
await resetDriverForTests();
process.exit(0);
