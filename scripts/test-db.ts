/**
 * Vitest global setup: boots a throwaway PostgreSQL server, applies the
 * migrations, and exposes its URL as TEST_DATABASE_URL.
 */
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMigrations } from "../packages/database/src/migrate";

export default async function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "krello-test-pg-"));
  const port = 54400 + Math.floor(Math.random() * 400);
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "krello",
    password: "krello",
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("krello_test");
  const url = `postgres://krello:krello@localhost:${port}/krello_test`;
  await runMigrations(url);
  process.env.TEST_DATABASE_URL = url;

  return async () => {
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}
