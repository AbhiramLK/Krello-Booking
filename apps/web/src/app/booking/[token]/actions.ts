"use server";

import { z } from "zod";
import { cancelByToken } from "@krello/core";
import { runAction, type ActionResult } from "@/lib/action";
import { getDb } from "@/lib/db";

const cancelSchema = z.object({
  token: z.string().min(20).max(100),
  reason: z
    .string()
    .trim()
    .max(500, "Keep the reason to 500 characters or fewer.")
    .optional()
    .transform((s) => s || undefined),
});

/** Cancels the booking behind a status link. Holding the link is the permission. */
export async function cancelBookingAction(input: { token: string; reason?: string }): Promise<ActionResult<{ status: string }>> {
  return runAction(async () => {
    const { token, reason } = cancelSchema.parse(input);
    const view = await cancelByToken(getDb(), token, reason);
    return { status: view.status };
  });
}
