/** Usage : tsx scripts/db-setup.ts [migrate|all] */
import { closeDb } from "../src/db/client";
import { runMigrations } from "../src/db/bootstrap";

process.loadEnvFile?.(".env");
const cmd = process.argv[2] ?? "all";
try {
  if (cmd === "migrate" || cmd === "all") {
    await runMigrations();
    console.log("migrations appliquées");
  }
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await closeDb();
}
