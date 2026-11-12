import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isEngineError } from "@krello/booking-engine";
import { getPublicAvailability, rateLimit } from "@krello/core";
import { getDb } from "@/lib/db";
import { jsonError, publicHandler } from "@/lib/public-api";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  locationId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Live slot states for one location and day. Never cached: a slot can be taken at any moment. */
export async function GET(request: NextRequest) {
  return publicHandler(async () => {
    const db = getDb();
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!(await rateLimit(db, `availability:ip:${ip}`, 120, 60))) {
      return jsonError(429, "rate_limited", "Too many requests. Please wait a moment and try again.");
    }
    const parsed = querySchema.safeParse({
      locationId: request.nextUrl.searchParams.get("locationId"),
      date: request.nextUrl.searchParams.get("date"),
    });
    if (!parsed.success) return jsonError(400, "bad_request", "Give a location and a date as YYYY-MM-DD.");
    try {
      const availability = await getPublicAvailability(db, parsed.data);
      return NextResponse.json(availability, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
    } catch (e) {
      if (isEngineError(e)) return jsonError(e.status, e.code, e.message);
      throw e;
    }
  });
}
