import { NextResponse, type NextRequest } from "next/server";
import { viewBookingByToken } from "@krello/core";
import { getDb } from "@/lib/db";
import { jsonError, publicHandler } from "@/lib/public-api";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };

/** What the status page polls. The token is a secret: it is never logged. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  return publicHandler(async () => {
    const found = await viewBookingByToken(getDb(), (await params).token);
    if (!found) return jsonError(404, "not_found", "This link is no longer valid.");
    const { status, pendingExpiresAt, canCancel } = found.view;
    return NextResponse.json({ status, pendingExpiresAt, canCancel }, { headers: HEADERS });
  });
}
