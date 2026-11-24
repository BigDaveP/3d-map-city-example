/** Au démarrage du serveur : migrations + seed si DB_AUTO_SETUP=1 (image Docker / Coolify). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.DB_AUTO_SETUP !== "1") return;
  const { runMigrations, seed } = await import("./db/bootstrap");
  try {
    await runMigrations();
    console.log("[db] migrations appliquées, seed :", await seed());
  } catch (e) {
    console.error("[db] initialisation impossible, la démo utilisera la mémoire :", (e as Error).message);
  }
}
