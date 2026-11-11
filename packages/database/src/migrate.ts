import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./index";

export const migrationsFolder = path.resolve(import.meta.dirname, "..", "drizzle");

export async function runMigrations(url: string) {
  const { db, close } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const url = process.env.DATABASE_URL ?? "postgres://krello:krello@localhost:54329/krello";
  await runMigrations(url);
  console.log("Migrations applied.");
}
