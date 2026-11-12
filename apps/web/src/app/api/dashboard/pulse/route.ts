import { NextResponse } from "next/server";
import { getPulse } from "@krello/core";
import { getDb } from "@/lib/db";
import { jsonError, publicHandler } from "@/lib/public-api";
import { resolveTenant } from "@/lib/session";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/**
 * What the dashboard polls every 20 seconds: live request count, unread
 * notifications and the next request deadline, for the member's own business
 * and locations. Signed out is 401; no membership is 404.
 */
export async function GET() {
  return publicHandler(async () => {
    const found = await resolveTenant();
    if (!found.ok) {
      return found.reason === "signed_out"
        ? jsonError(401, "unauthenticated", "Sign in to continue.")
        : jsonError(404, "not_found", "No business found.");
    }
    const { pendingCount, unread, nextExpiryAt } = await getPulse(getDb(), found.ctx);
    return NextResponse.json({ pendingCount, unread, nextExpiryAt: nextExpiryAt?.toISOString() ?? null }, { headers: HEADERS });
  });
}
