"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { normalisePhone, requestOtp, verifyOtp } from "@krello/core";
import { runAction, type ActionResult } from "@/lib/action";
import { getDb } from "@/lib/db";
import { endSession, startSession } from "@/lib/session";

export async function requestOtpAction(input: {
  phone: string;
}): Promise<ActionResult<{ phone: string; retryAfterSeconds: number; demoCode?: string }>> {
  return runAction(async () => {
    const forwarded = (await headers()).get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() || null;
    const result = await requestOtp(getDb(), { phone: input.phone, ip });
    // requestOtp has already validated the number, so this is never null.
    return { phone: normalisePhone(input.phone)!, retryAfterSeconds: result.retryAfterSeconds, demoCode: result.demoCode };
  });
}

export async function verifyOtpAction(input: {
  phone: string;
  code: string;
  name?: string;
}): Promise<ActionResult<{ userId: string; name: string | null }>> {
  return runAction(async () => {
    const user = await verifyOtp(getDb(), input);
    await startSession(user.id);
    return { userId: user.id, name: user.name };
  });
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/");
}
