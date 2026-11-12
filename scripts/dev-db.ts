/**
 * Starts a real PostgreSQL server for local development, with no Docker needed.
 * Data lives in .pgdata/ at the repo root. Stop with Ctrl+C.
 */
import { startDevPostgres } from "./lib/dev-postgres";

const port = Number(process.env.PGPORT ?? 54329);
const pg = await startDevPostgres(port);

console.log(`PostgreSQL ready on ${pg.url}`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
