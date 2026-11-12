"use server";

import { headers } from "next/headers";
import { AppError, quoteBooking, submitBookingRequest, type BookingQuote } from "@krello/core";
import { runAction, type ActionResult } from "@/lib/action";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { selectionSchema, submitRequestSchema, type SelectionInput, type SubmitRequestInput } from "./schemas";

/** Prices a selection by the engine's rules. Nothing is held or booked. */
export async function quoteAction(input: SelectionInput): Promise<ActionResult<BookingQuote>> {
  return runAction(async () => {
    const { locationId, resourceIds, startsAt, endsAt, groupSize } = selectionSchema.parse(input);
    return quoteBooking(getDb(), { locationId, resourceIds, startsAt, endsAt, groupSize });
  });
}

/**
 * Sends the request as the signed-in customer. The phone number comes from the
 * session, never from the form; signed-out callers get `auth_required`.
 */
export async function submitRequestAction(input: SubmitRequestInput): Promise<ActionResult<{ statusUrl: string }>> {
  return runAction(async () => {
    const p = submitRequestSchema.parse(input);
    const user = await getCurrentUser();
    if (!user) throw new AppError("auth_required", "Verify your phone number to send the request.", 401);
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
    const { statusToken } = await submitBookingRequest(getDb(), {
      user,
      locationId: p.locationId,
      resourceIds: p.resourceIds,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      groupSize: p.groupSize,
      name: p.name,
      email: p.email,
      notes: p.notes,
      idempotencyKey: p.idempotencyKey,
      ip,
    });
    return { statusUrl: `/booking/${statusToken}` };
  });
}
