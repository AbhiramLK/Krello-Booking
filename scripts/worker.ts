/**
 * Background worker: the jobs that keep bookings honest when nobody is clicking.
 *
 * Each cycle it
 *   1. expires pending requests whose deadline has passed (releasing their slots),
 *   2. delivers queued notifications to the in-app bell (browser pushes are not built),
 *   3. deletes one-time codes and rate-limit counters that are long out of date.
 *
 *   pnpm worker            loop forever, one cycle every WORKER_INTERVAL_MS (default 15000)
 *   pnpm worker -- --once  run a single cycle and exit (for a cloud scheduler)
 *
 * Cycles never overlap: the next one is scheduled only after the previous one
 * has finished. A cycle that fails is logged and the loop carries on.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { createDb, type Db } from "@krello/database";
import { expireOverdueBookings } from "@krello/booking-engine";
import { cleanupExpiredOtps, processOutbox } from "@krello/core";

export interface WorkerResult {
  /** Pending requests moved to expired. */
  expired: number;
  /** Notification events delivered. */
  notified: number;
  /** Notification events that failed and will be retried (or given up on). */
  failed: number;
}

/** One pass over all three jobs. Safe to run from several processes at once. */
export async function runWorkerOnce(db: Db, now: Date = new Date()): Promise<WorkerResult> {
  // Expiry first, so the "request expired" notices go out in this same pass.
  const expired = await expireOverdueBookings(db, { now });
  const outbox = await processOutbox(db, { now });
  await cleanupExpiredOtps(db, now);
  return { expired, notified: outbox.processed, failed: outbox.failed };
}

const DEFAULT_INTERVAL_MS = 15_000;

function intervalFromEnv(): number {
  const n = Number(process.env.WORKER_INTERVAL_MS);
  return Number.isFinite(n) && n >= 100 ? n : DEFAULT_INTERVAL_MS;
}

function logCycle(r: WorkerResult) {
  if (!r.expired && !r.notified && !r.failed) return;
  console.log(`[worker] ${new Date().toISOString()} expired ${r.expired}, notified ${r.notified}, failed ${r.failed}`);
}

async function main() {
  // The root .env, when there is one. Variables already in the environment win.
  const envFile = path.resolve(import.meta.dirname, "..", ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const once = process.argv.includes("--once");
  const intervalMs = intervalFromEnv();
  const url = process.env.DATABASE_URL ?? "postgres://krello:krello@localhost:54329/krello";
  const { db, close } = createDb(url, { max: 4 });

  let stopping = false;
  let wake: (() => void) | undefined;
  const stop = () => {
    stopping = true;
    wake?.();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  try {
    if (once) {
      logCycle(await runWorkerOnce(db));
      return;
    }
    console.log(`[worker] started, one cycle every ${intervalMs / 1000}s. Press Ctrl+C to stop.`);
    while (!stopping) {
      try {
        logCycle(await runWorkerOnce(db));
      } catch (e) {
        console.error(`[worker] cycle failed: ${e instanceof Error ? e.message : e}`);
      }
      if (stopping) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, intervalMs);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wake = undefined;
    }
    console.log("[worker] stopped.");
  } catch (e) {
    console.error(`[worker] failed: ${e instanceof Error ? e.message : e}`);
    console.error("Is the database running and migrated? Try: pnpm db:start, then pnpm db:migrate.");
    process.exitCode = 1;
  } finally {
    await close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await main();
}
