"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppError, addNoteForTenant, decideBooking, getTenantContext, markNotificationsRead } from "@krello/core";
import type { BookingStatus } from "@krello/booking-engine/labels";
import { runAction, type ActionResult } from "@/lib/action";
import { getDb } from "@/lib/db";
import {
  BOOKING_SEARCH_COOKIE,
  BOOKING_SEARCH_DELETE,
  BOOKING_SEARCH_MAX_AGE_SECONDS,
  BOOKING_SEARCH_PATH,
  bindSearch,
} from "@/lib/booking-search-cookie";
import { BUSINESS_COOKIE, getCurrentUser, resolveTenant } from "@/lib/session";
import { addNoteSchema, bookingFiltersSchema, bookingsHref, businessIdSchema, decideBookingSchema } from "./schemas";
import { actionTenant as tenant } from "./tenant";

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
    const jar = await cookies();
    jar.set(BUSINESS_COOKIE, ctx.business.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 365 * 86_400,
    });
    // The remembered search belongs to the business it was made in.
    jar.delete(BOOKING_SEARCH_DELETE);
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

const SEARCH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: BOOKING_SEARCH_PATH,
  maxAge: BOOKING_SEARCH_MAX_AGE_SECONDS,
};

/**
 * Applies the bookings list filters. Everything but the search text goes in the
 * address; the search text, which may be a phone number, goes in a cookie bound
 * to this user and business so it never appears in a URL or request log.
 */
export async function filterBookingsAction(form: FormData): Promise<void> {
  const field = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v ? v : undefined;
  };
  const f = bookingFiltersSchema.parse({
    q: field("q"),
    status: field("status"),
    source: field("source"),
    payment: field("payment"),
    location: field("location"),
    from: field("from"),
    to: field("to"),
  });
  const found = await resolveTenant();
  if (!found.ok) redirect(`/login?next=${encodeURIComponent("/dashboard/bookings")}`);
  const jar = await cookies();
  if (f.q) jar.set(BOOKING_SEARCH_COOKIE, bindSearch(found.ctx.user.id, found.ctx.business.id, f.q), SEARCH_COOKIE_OPTIONS);
  else jar.delete(BOOKING_SEARCH_DELETE);
  redirect(bookingsHref(f));
}

/** Clears every bookings list filter, including the remembered search text. */
export async function clearBookingFiltersAction(): Promise<void> {
  (await cookies()).delete(BOOKING_SEARCH_DELETE);
  redirect("/dashboard/bookings");
}
