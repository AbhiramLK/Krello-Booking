"use server";

import { revalidatePath } from "next/cache";
import { blockResource, createManualBooking, quoteManualBooking, unblockResource } from "@krello/core";
import type { BookingStatus } from "@krello/booking-engine/labels";
import { runAction, type ActionResult } from "@/lib/action";
import { getDb } from "@/lib/db";
import { actionTenant } from "../tenant";
import { blockResourceSchema, manualBookingSchema, quoteManualBookingSchema, unblockSchema } from "./schemas";

// Each action validates its payload, then passes core only the named fields it
// parsed. The business comes from the session, never from the payload; core
// checks the location or resource against the business and the member's locations.

/** The price of a manual booking before it is saved. */
export async function quoteManualBookingAction(
  input: unknown,
): Promise<ActionResult<{ total: number; lines: { resourceId: string; name: string; amount: number }[] }>> {
  return runAction(async () => {
    const { locationId, resourceIds, startsAt, endsAt, groupSize } = quoteManualBookingSchema.parse(input);
    const ctx = await actionTenant();
    const quote = await quoteManualBooking(getDb(), ctx, { locationId, resourceIds, startsAt, endsAt, groupSize });
    return { total: quote.total, lines: quote.lines.map((l) => ({ resourceId: l.resourceId, name: l.name, amount: l.amount })) };
  });
}

/** Enters a phone, walk-in or venue-added booking. It starts approved. */
export async function createManualBookingAction(
  input: unknown,
): Promise<ActionResult<{ id: string; reference: string; status: BookingStatus; total: number }>> {
  return runAction(async () => {
    const { locationId, resourceIds, startsAt, endsAt, source, name, phone, groupSize, notes, idempotencyKey } = manualBookingSchema.parse(input);
    const ctx = await actionTenant();
    const { booking } = await createManualBooking(getDb(), ctx, {
      locationId,
      resourceIds,
      startsAt,
      endsAt,
      source,
      name,
      phone,
      groupSize,
      notes,
      idempotencyKey,
    });
    revalidatePath("/dashboard", "layout");
    return { id: booking.id, reference: booking.publicReference, status: booking.status, total: booking.totalAmount };
  });
}

/** Blocks a resource for a period. Refused while bookings overlap it. */
export async function blockResourceAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { resourceId, startsAt, endsAt, reason } = blockResourceSchema.parse(input);
    const ctx = await actionTenant();
    const block = await blockResource(getDb(), ctx, { resourceId, startsAt, endsAt, reason });
    revalidatePath("/dashboard", "layout");
    return { id: block.id };
  });
}

/** Lifts a block. */
export async function unblockResourceAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { blockId } = unblockSchema.parse(input);
    const ctx = await actionTenant();
    await unblockResource(getDb(), ctx, blockId);
    revalidatePath("/dashboard", "layout");
    return null;
  });
}
