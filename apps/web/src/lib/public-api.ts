import "server-only";
import { NextResponse } from "next/server";

const CACHE_OK = { "Cache-Control": "public, max-age=60" };
const CACHE_ERROR = { "Cache-Control": "no-store" };

export function jsonOk<T>(body: T) {
  return NextResponse.json(body, { headers: CACHE_OK });
}

/** `{ error: { code, message } }` with the right status. Errors are never cached. */
export function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: CACHE_ERROR });
}

/** Wraps a public GET handler so an unexpected failure is a clean 500 and not a stack trace. */
export async function publicHandler(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    return jsonError(500, "internal", "Something went wrong. Please try again.");
  }
}
