import "server-only";
import { cache } from "react";
import { getTenantAccess } from "@krello/booking-engine";
import { listTenantLocations, type TenantContext } from "@krello/core";
import { getDb } from "@/lib/db";

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
