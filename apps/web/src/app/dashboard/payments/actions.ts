"use server";

import { revalidatePath } from "next/cache";
import { recordCollection } from "@krello/core";
import type { BookingRow } from "@krello/booking-engine";
import { runAction, type ActionResult } from "@/lib/action";
import { getDb } from "@/lib/db";
import { actionTenant as tenant } from "../tenant";
import { recordPaymentSchema } from "./schemas";

/**
 * Records a payment taken at the venue, or a refund. The amount arrives as the
 * rupees the member typed and is parsed in core; the business, the member and
 * the time all come from the server. Permission and location are checked in
 * core, and the booking's amount due is read under a row lock in the engine.
 */
export async function recordPaymentAction(input: {
  bookingId: string;
  kind: string;
  amountRupees: string;
  method: string;
  reference?: string;
  notes?: string;
  idempotencyKey: string;
}): Promise<ActionResult<{ paymentStatus: BookingRow["paymentStatus"]; amountCollected: number; replayed: boolean }>> {
  return runAction(async () => {
    const parsed = recordPaymentSchema.parse(input);
    const ctx = await tenant();
    const { booking, replayed } = await recordCollection(getDb(), ctx, {
      bookingId: parsed.bookingId,
      kind: parsed.kind,
      amountRupees: parsed.amountRupees,
      method: parsed.method,
      reference: parsed.reference,
      notes: parsed.notes,
      idempotencyKey: parsed.idempotencyKey,
    });
    revalidatePath("/dashboard", "layout");
    return { paymentStatus: booking.paymentStatus, amountCollected: booking.amountCollected, replayed };
  });
}
