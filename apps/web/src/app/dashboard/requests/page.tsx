import { bookingActions, listBookingsForTenant } from "@krello/core";
import { LocationFilter } from "@/components/dashboard/location-filter";
import { getDb } from "@/lib/db";
import { requireTenant } from "@/lib/session";
import { firstParam, locationParamSchema } from "../schemas";
import { getLocations, getWritable } from "../tenant";
import { RequestCard } from "./request-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Requests" };

/** Pending online requests, the one with the least time left first. */
export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireTenant("bookings.view");
  const locationId = locationParamSchema.parse(firstParam((await searchParams).location));
  const now = new Date();
  const [locations, writable, list] = await Promise.all([
    getLocations(ctx),
    getWritable(ctx.business.id),
    listBookingsForTenant(getDb(), ctx, { statuses: ["pending"], locationId, order: "expires_asc", pageSize: 200 }),
  ]);
  // Overdue requests the worker has not recorded yet go last: they can no longer be decided.
  const isLive = (b: (typeof list.items)[number]) => b.pendingExpiresAt !== null && b.pendingExpiresAt.getTime() > now.getTime();
  const items = [...list.items.filter(isLive), ...list.items.filter((b) => !isLive(b))];
  const live = items.filter(isLive).length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Requests</h1>
          <p className="mt-1 text-muted-foreground">
            {live === 0 ? "Nothing waiting for an answer." : `${live} waiting for an answer, the soonest deadline first.`} This page updates by itself.
          </p>
        </div>
        <LocationFilter locations={locations} value={locationId} />
      </div>

      {items.length === 0 ? (
        <p className="mt-8 rounded-card border bg-card p-6 text-[15px] text-muted-foreground">
          No requests are waiting. New online requests appear here as they arrive, and the Requests count in the menu goes up.
        </p>
      ) : (
        <ul aria-label="Pending requests" className="mt-6 flex flex-col gap-3">
          {items.map((b) => (
            <RequestCard
              key={b.id}
              booking={b}
              actions={bookingActions(ctx, b, now)}
              writable={writable}
              showLocation={locations.length > 1}
              now={now}
            />
          ))}
        </ul>
      )}
    </>
  );
}
