// Applies SQL migrations in db/migrations (PGlite when DATABASE_URL is empty).
import { driverKind, getDriver, resetDriverForTests } from "@/server/db";

await getDriver();
console.log(`Migrações aplicadas (${await driverKind()}).`);
await resetDriverForTests();
process.exit(0);
