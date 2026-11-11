import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export * from "./helpers";
export { schema };

export type Db = PostgresJsDatabase<typeof schema>;
/** A database handle or an open transaction on one. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export interface DbHandle {
  db: Db;
  close: () => Promise<void>;
}

export function createDb(url: string, opts: { max?: number } = {}): DbHandle {
  const client = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}

let shared: DbHandle | undefined;

/** Process-wide handle, created from DATABASE_URL on first use. */
export function getDb(): Db {
  if (!shared) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // Survive Next.js dev hot reloads without leaking connections.
    const g = globalThis as { __krelloDb?: DbHandle };
    shared = g.__krelloDb ??= createDb(url);
  }
  return shared.db;
}

/** SQLSTATE of a Postgres error, if the value is one. */
export function pgErrorCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}
