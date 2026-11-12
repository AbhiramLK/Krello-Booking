import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  AppError,
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
  createSession,
  getSessionUser,
  getTenantContext,
  listMemberships,
  revokeSession,
  type Permission,
  type TenantContext,
  type UserRow,
} from "@krello/core";
import { getDb } from "./db";

/** Remembers which business a member with several memberships is working in. */
export const BUSINESS_COOKIE = "krello_business";

export async function getCurrentUser(): Promise<UserRow | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getSessionUser(getDb(), token);
}

export async function requireUser(next: string): Promise<UserRow> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

/** Server actions and route handlers only: cookies cannot be set while rendering. */
export async function startSession(userId: string): Promise<void> {
  const { token, expiresAt } = await createSession(getDb(), userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
    maxAge: SESSION_TTL_DAYS * 86_400,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(getDb(), token);
  jar.delete(SESSION_COOKIE);
}

/**
 * The signed-in user's active business context. Access comes from the
 * membership row; the cookie only chooses between memberships the user holds.
 */
export async function requireTenant(permission?: Permission): Promise<TenantContext> {
  const user = await requireUser("/dashboard");
  const db = getDb();
  const memberships = await listMemberships(db, user.id);
  const wanted = (await cookies()).get(BUSINESS_COOKIE)?.value;
  const chosen = memberships.find((m) => m.business.id === wanted) ?? memberships[0];
  if (!chosen) notFound();
  const ctx = await getTenantContext(db, user, chosen.business.id);
  if (!ctx) notFound();
  if (permission && !ctx.can(permission)) {
    throw new AppError("forbidden", "You do not have permission to do that.", 403);
  }
  return ctx;
}
