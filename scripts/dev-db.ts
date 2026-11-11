/**
 * Starts a real PostgreSQL server for local development, with no Docker needed.
 * Data lives in .pgdata/ at the repo root. Stop with Ctrl+C.
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(import.meta.dirname, "..", ".pgdata");
const port = Number(process.env.PGPORT ?? 54329);

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

console.log(`PostgreSQL ready on postgres://krello:krello@localhost:${port}/krello`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
