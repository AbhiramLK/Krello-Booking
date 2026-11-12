/**
 * The app under test for `pnpm e2e` (started by playwright.config.ts).
 *
 * Boots a throwaway PostgreSQL server on a free port, migrates and seeds it,
 * builds the web app (skip with E2E_SKIP_BUILD=1 to reuse the last build) and
 * serves it on E2E_PORT, pointed at that database. The development database in
 * .pgdata/ is never touched: the URL below is handed to the app through the
 * environment, which the root .env does not override.
 *
 * Stops cleanly on SIGINT/SIGTERM. Playwright ends it by killing the process
 * tree, so on Windows the data directory can be left behind; the next run
 * clears the whole .e2e-data/ folder first.
 */
import EmbeddedPostgres from "embedded-postgres";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { createDb } from "@krello/database";
import { runMigrations } from "../packages/database/src/migrate";
import { seedDemo } from "./seed";
import { freePort, killTree, startNode } from "./lib/processes";

const root = path.resolve(import.meta.dirname, "..");
const webDir = path.join(root, "apps", "web");
const nextRunner = path.join(webDir, "scripts", "next-with-env.mjs");

const appPort = Number(process.env.E2E_PORT);
if (!appPort) throw new Error("E2E_PORT is not set; run through `pnpm e2e`.");

const dataRoot = path.join(root, ".e2e-data");
rmSync(dataRoot, { recursive: true, force: true });
const dataDir = path.join(dataRoot, `pg-${appPort}`);
mkdirSync(dataRoot, { recursive: true });

const dbPort = await freePort();
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "krello",
  password: "krello",
  port: dbPort,
  persistent: false,
  onLog: () => {},
  onError: () => {},
});

let app: ReturnType<typeof startNode> | undefined;
let stopping = false;
async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  if (app) killTree(app);
  await pg.stop().catch(() => {});
  rmSync(dataRoot, { recursive: true, force: true });
  process.exit(code);
}
process.on("SIGINT", () => void stop(0));
process.on("SIGTERM", () => void stop(0));

try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("krello_e2e");
  const databaseUrl = `postgres://krello:krello@localhost:${dbPort}/krello_e2e`;
  await runMigrations(databaseUrl);
  const { db, close } = createDb(databaseUrl, { max: 2 });
  try {
    const summary = await seedDemo(db);
    console.log(`[e2e] seeded ${summary.businesses} businesses and ${summary.bookings} bookings on port ${dbPort}`);
  } finally {
    await close();
  }

  const env = {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-only-secret-e2e-only-secret",
    SUPER_ADMIN_PHONE: "+919000000001",
    // The tests read the sign-in code from the on-screen demo notice.
    OTP_DEMO_MODE: "1",
    PORT: String(appPort),
  };

  if (!process.env.E2E_SKIP_BUILD) {
    console.log("[e2e] building the web app ...");
    const build = startNode([nextRunner, "build"], { cwd: webDir, env });
    const code = await new Promise<number>((resolve) => build.on("exit", (c) => resolve(c ?? 1)));
    if (code !== 0) throw new Error(`next build failed with exit code ${code}`);
  }

  console.log(`[e2e] serving on http://localhost:${appPort}`);
  app = startNode([nextRunner, "start", "-p", String(appPort)], { cwd: webDir, env });
  app.on("exit", (code) => {
    if (!stopping) void stop(code ?? 1);
  });
  // The app child keeps this process alive; its exit handler above ends the run.
  await new Promise<never>(() => {});
} catch (e) {
  console.error(`[e2e] could not start: ${e instanceof Error ? e.message : e}`);
  await stop(1);
}
