import "server-only";
import { unstable_rethrow } from "next/navigation";
import { AppError } from "@krello/core";
import { EngineError } from "@krello/booking-engine";
import { logUnexpected } from "./log-error";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

const INTERNAL_MESSAGE = "Something went wrong. Please try again.";

function isZodError(e: unknown): e is { issues: { message: string }[] } {
  // Duck-typed so a second copy of zod in the workspace still matches.
  return e instanceof Error && e.name === "ZodError" && Array.isArray((e as { issues?: unknown }).issues);
}

/**
 * Wraps a server action body. Expected failures become a result the form can
 * show; redirect and not-found signals pass through untouched.
 */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof EngineError || e instanceof AppError) return { ok: false, code: e.code, message: e.message };
    if (isZodError(e)) return { ok: false, code: "validation", message: e.issues[0]?.message ?? "Check the details and try again." };
    logUnexpected("action", e);
    return { ok: false, code: "internal", message: INTERNAL_MESSAGE };
  }
}
