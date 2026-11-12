"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { AppError, addNoteForTenant, decideBooking, getTenantContext, markNotificationsRead } from "@krello/core";
import type { BookingStatus } from "@krello/booking-engine/labels";
import { runAction, type ActionResult } from "@/lib/action";
import { getDb } from "@/lib/db";
import { BUSINESS_COOKIE, getCurrentUser, resolveTenant } from "@/lib/session";
import { addNoteSchema, businessIdSchema, decideBookingSchema } from "./schemas";

/** The member's business, or a failure the client can show. Never redirects: this runs from a client call. */
async function tenant() {
  const found = await resolveTenant();
  if (found.ok) return found.ctx;
  throw found.reason === "signed_out"
    ? new AppError("unauthenticated", "Your session has ended. Sign in again to continue.", 401)
    : new AppError("forbidden", "You are not a member of this business.", 403);
}

/** Approves, declines, cancels, completes or marks a no-show. Permission and location are checked in core. */
export async function decideBookingAction(input: {
  bookingId: string;
  action: string;
  reason?: string;
}): Promise<ActionResult<{ status: BookingStatus }>> {
  return runAction(async () => {
    const { bookingId, action, reason } = decideBookingSchema.parse(input);
    const ctx = await tenant();
    const { booking } = await decideBooking(getDb(), ctx, { bookingId, action, reason });
    revalidatePath("/dashboard", "layout");
    return { status: booking.status };
  });
}

/** Adds an internal note. Notes are for the venue's team only. */
export async function addNoteAction(input: { bookingId: string; note: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { bookingId, note } = addNoteSchema.parse(input);
    const ctx = await tenant();
    await addNoteForTenant(getDb(), ctx, bookingId, note);
    revalidatePath(`/dashboard/bookings/${bookingId}`);
    return null;
  });
}

/** Chooses which of the user's businesses the dashboard shows. The cookie is set only for a real membership. */
export async function switchBusinessAction(businessId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = businessIdSchema.parse(businessId);
    const user = await getCurrentUser();
    if (!user) throw new AppError("unauthenticated", "Your session has ended. Sign in again to continue.", 401);
    const ctx = await getTenantContext(getDb(), user, id);
    if (!ctx) throw new AppError("not_found", "Business not found.", 404);
    (await cookies()).set(BUSINESS_COOKIE, ctx.business.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 365 * 86_400,
    });
    revalidatePath("/dashboard", "layout");
    return null;
  });
}

/** Marks this business's notifications read for the signed-in member. */
export async function markNotificationsReadAction(): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ctx = await tenant();
    await markNotificationsRead(getDb(), ctx.user.id, ctx.business.id);
    revalidatePath("/dashboard", "layout");
    return null;
  });
}
