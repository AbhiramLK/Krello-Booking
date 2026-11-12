"use server";

import { revalidatePath } from "next/cache";
import { AppError, cancelOwnBooking, updateProfile } from "@krello/core";
import { runAction, type ActionResult } from "@/lib/action";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { cancelAccountBookingSchema, updateProfileSchema } from "./schemas";

/** The signed-in customer, or a failure the form can show. Never redirects: this runs from a client call. */
async function signedIn() {
  const user = await getCurrentUser();
  if (!user) throw new AppError("unauthenticated", "Your session has ended. Sign in again to continue.", 401);
  return user;
}

/** Cancels one of the signed-in customer's own bookings. Someone else's booking is not found. */
export async function cancelAccountBookingAction(input: { bookingId: string; reason?: string }): Promise<ActionResult<{ status: string }>> {
  return runAction(async () => {
    const { bookingId, reason } = cancelAccountBookingSchema.parse(input);
    const user = await signedIn();
    const view = await cancelOwnBooking(getDb(), user.id, bookingId, reason);
    revalidatePath("/account");
    return { status: view.status };
  });
}

/** Saves the signed-in customer's name and email. The phone number cannot be changed here. */
export async function updateProfileAction(input: { name: string; email?: string | null }): Promise<ActionResult<{ name: string; email: string | null }>> {
  return runAction(async () => {
    const { name, email } = updateProfileSchema.parse(input);
    const user = await signedIn();
    const saved = await updateProfile(getDb(), user.id, { name, email });
    revalidatePath("/account", "layout");
    return { name: saved.name ?? "", email: saved.email };
  });
}
