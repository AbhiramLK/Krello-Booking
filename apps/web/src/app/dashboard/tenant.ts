import "server-only";
import { cache } from "react";
import { getTenantAccess } from "@krello/booking-engine";
import { AppError, listTenantLocations, type TenantContext } from "@krello/core";
import { getDb } from "@/lib/db";
import { resolveTenant } from "@/lib/session";

// Per-request lookups the layout and its pages both need. A layout cannot pass
// props to its page, so they share these cached reads instead.

/** False while the subscription has lapsed: the dashboard is read-only. */
export const getWritable = cache(async (businessId: string) => (await getTenantAccess(getDb(), businessId)).writable);

/** Locations the member may open. `ctx` comes from the cached tenant lookup, so the key is stable. */
export const getLocations = cache((ctx: TenantContext) => listTenantLocations(getDb(), ctx));

/** Timezone for headings and times that are not tied to one booking. */
export async function primaryTimezone(ctx: TenantContext): Promise<string> {
  return (await getLocations(ctx))[0]?.timezone ?? "Asia/Kolkata";
}

/** The member's business for a server action, or a failure the client can show. Never redirects: actions run from a client call. */
export async function actionTenant(): Promise<TenantContext> {
  const found = await resolveTenant();
  if (found.ok) return found.ctx;
  throw found.reason === "signed_out"
    ? new AppError("unauthenticated", "Your session has ended. Sign in again to continue.", 401)
    : new AppError("forbidden", "You are not a member of this business.", 403);
}
