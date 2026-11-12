import { NextResponse, type NextRequest } from "next/server";
import { getCustomerBooking } from "@krello/core";
import { getDb } from "@/lib/db";
import { jsonError, publicHandler } from "@/lib/public-api";
import { getCurrentUser } from "@/lib/session";
import { bookingIdSchema } from "@/app/account/schemas";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/**
 * What the account booking page polls: the same three fields as the status-link
 * endpoint. The user comes from the session, so anyone but the owner gets 404.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return publicHandler(async () => {
    const id = bookingIdSchema.safeParse((await params).id);
    if (!id.success) return jsonError(404, "not_found", "Booking not found.");
    const user = await getCurrentUser();
    if (!user) return jsonError(401, "unauthenticated", "Sign in to continue.");
    const found = await getCustomerBooking(getDb(), user.id, id.data);
    if (!found) return jsonError(404, "not_found", "Booking not found.");
    const { status, pendingExpiresAt, canCancel } = found.view;
    return NextResponse.json({ status, pendingExpiresAt, canCancel }, { headers: HEADERS });
  });
}
