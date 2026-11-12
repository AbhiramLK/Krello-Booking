/**
 * `pnpm dev:all`: everything needed to work on the product, in one terminal.
 *
 *   1. the development database (reused if it is already running, e.g. from `pnpm db:start`),
 *   2. migrations,
 *   3. the web app (http://localhost:3000) and the background worker, side by side.
 *
 * Ctrl+C stops what this script started. A database that was already running is left running.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { createDb } from "@krello/database";
import { runMigrations } from "../packages/database/src/migrate";
import { DEV_DB_PORT, startDevPostgres, type DevPostgres } from "./lib/dev-postgres";
import { exited, killTree, sleep, startNode } from "./lib/processes";

const root = path.resolve(import.meta.dirname, "..");
const envFile = path.join(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const databaseUrl = process.env.DATABASE_URL ?? `postgres://krello:krello@localhost:${DEV_DB_PORT}/krello`;
process.env.DATABASE_URL = databaseUrl;

async function acceptsConnections(url: string): Promise<boolean> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  } finally {
    await close().catch(() => {});
  }
}

async function waitForDatabase(url: string, seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds * 2; i++) {
    if (await acceptsConnections(url)) return true;
    await sleep(500);
  }
  return false;
}

let database: DevPostgres | undefined;
const children: ReturnType<typeof startNode>[] = [];
let stopping = false;

async function shutdown(code: number): Promise<never> {
  if (stopping) return new Promise<never>(() => {});
  stopping = true;
  console.log("\n[dev:all] stopping ...");
  for (const child of children) killTree(child);
  // Give the app a moment to let go of the database before it goes away.
  for (let i = 0; i < 20 && !children.every(exited); i++) await sleep(250);
  for (const child of children) killTree(child, true);
  await database?.stop().catch(() => {});
  process.exit(code);
}
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

try {
  const target = new URL(databaseUrl);
  const isLocal = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname);

  if (await acceptsConnections(databaseUrl)) {
    console.log(`[dev:all] using the database already running on port ${target.port || 5432}`);
  } else if (isLocal) {
    console.log("[dev:all] starting the development database ...");
    database = await startDevPostgres(Number(target.port) || DEV_DB_PORT);
    if (!(await waitForDatabase(databaseUrl, 30))) throw new Error(`The database did not accept connections at ${target.host}.`);
  } else {
    throw new Error(`Cannot reach the database at ${target.host}. Check DATABASE_URL in .env.`);
  }

  await runMigrations(databaseUrl);
  console.log("[dev:all] migrations applied; starting the web app and the worker");

  const web = startNode([path.join(root, "apps", "web", "scripts", "next-with-env.mjs"), "dev"], { cwd: path.join(root, "apps", "web") });
  const worker = startNode(["--import", "tsx", "scripts/worker.ts"], { cwd: root });
  children.push(web, worker);
  const names = new Map([
    [web, "web app"],
    [worker, "worker"],
  ]);
  for (const child of children) {
    child.on("exit", (code) => {
      if (stopping) return;
      console.error(`[dev:all] the ${names.get(child)} stopped (exit code ${code ?? "none"}); stopping the rest.`);
      void shutdown(code || 1);
    });
  }
  await new Promise<never>(() => {});
} catch (e) {
  console.error(`[dev:all] ${e instanceof Error ? e.message : e}`);
  await shutdown(1);
}
