/**
 * The development PostgreSQL server, shared by `pnpm db:start` and `pnpm dev:all`.
 * Real PostgreSQL, no Docker. Data lives in .pgdata/ at the repo root
 * (PGDATA_DIR overrides the folder).
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

export const DEV_DB_PORT = 54329;

export interface DevPostgres {
  readonly url: string;
  stop(): Promise<void>;
}

export async function startDevPostgres(port: number = DEV_DB_PORT): Promise<DevPostgres> {
  const dataDir = process.env.PGDATA_DIR ?? path.resolve(import.meta.dirname, "..", "..", ".pgdata");
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "krello",
    password: "krello",
    port,
    persistent: true,
    onLog: () => {},
    onError: (e) => console.error(e),
  });

  const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase("krello");

  return {
    url: `postgres://krello:krello@localhost:${port}/krello`,
    stop: () => pg.stop(),
  };
}
