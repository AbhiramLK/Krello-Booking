import { NextResponse, type NextRequest } from "next/server";
import { AppError, getCalendarDay } from "@krello/core";
import { isEngineError } from "@krello/booking-engine";
import { getDb } from "@/lib/db";
import { jsonError, publicHandler } from "@/lib/public-api";
import { resolveTenant } from "@/lib/session";
import { dayQuerySchema } from "@/app/dashboard/calendar/schemas";
import { toDayView } from "@/app/dashboard/calendar/view-model";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/**
 * One day of the member's calendar as the grid shows it: slot states, bookings
 * and blocks, for a location the member may open. The grid fetches it to catch
 * up after a conflict and while it stays open. It carries customer phone
 * numbers, so it is for signed-in members only and is never cached. Signed out
 * is 401; no business, or a location the member may not open, is 404.
 */
export async function GET(request: NextRequest) {
  return publicHandler(async () => {
    const found = await resolveTenant();
    if (!found.ok) {
      return found.reason === "signed_out"
        ? jsonError(401, "unauthenticated", "Sign in to continue.")
        : jsonError(404, "not_found", "No business found.");
    }
    const parsed = dayQuerySchema.safeParse({
      locationId: request.nextUrl.searchParams.get("locationId"),
      date: request.nextUrl.searchParams.get("date"),
    });
    if (!parsed.success) return jsonError(400, "bad_request", "Give a location and a date as YYYY-MM-DD.");
    try {
      const day = await getCalendarDay(getDb(), found.ctx, parsed.data);
      return NextResponse.json(toDayView(day), { headers: HEADERS });
    } catch (e) {
      if (isEngineError(e) || e instanceof AppError) return jsonError(e.status, e.code, e.message);
      throw e;
    }
  });
}
