import Link from "next/link";
import { Ban, CircleCheck, CircleDot } from "lucide-react";
import { getOverview, type ResourceNow } from "@krello/core";
import { localDateOf } from "@krello/booking-engine/time";
import { BookingRow } from "@/components/dashboard/booking-row";
import { ExpiryCountdown } from "@/components/dashboard/expiry-countdown";
import { LocationFilter } from "@/components/dashboard/location-filter";
import { getDb } from "@/lib/db";
import { formatDayLong, formatInr, formatRange } from "@/lib/format";
import { requireTenant } from "@/lib/session";
import { cn } from "@/lib/utils";
import { firstParam, locationParamSchema } from "./schemas";
import { getLocations } from "./tenant";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview" };

function Stat({ label, value, hint, href }: { label: string; value: string; hint: string; href?: string }) {
  const body = (
    <>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="tabular mt-1 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
    </>
  );
  const cls = "block h-full rounded-card border bg-card p-4 sm:p-5";
  return (
    <li>
      {href ? (
        <Link href={href} className={cn(cls, "transition-shadow hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2")}>
          {body}
        </Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

const RESOURCE_LOOK: Record<ResourceNow["state"], { label: string; icon: typeof CircleCheck; tone: string }> = {
  free: { label: "Free", icon: CircleCheck, tone: "bg-success/15 text-[#1b7a35]" },
  occupied: { label: "In use", icon: CircleDot, tone: "bg-info/10 text-[#0058b0]" },
  blocked: { label: "Blocked", icon: Ban, tone: "bg-muted text-muted-foreground" },
};

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-10" aria-label={title}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-card border bg-card p-5 text-[15px] text-muted-foreground">{children}</p>;

/** Today's picture at the venue: what is waiting, what is on, and what has been taken. */
export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireTenant("dashboard.view");
  const requested = locationParamSchema.parse(firstParam((await searchParams).location));
  const locations = await getLocations(ctx);
  const locationId = locations.some((l) => l.id === requested) ? requested : undefined;
  const now = new Date();
  const o = await getOverview(getDb(), ctx, { locationId, now });

  const tz = (locations.find((l) => l.id === locationId) ?? locations[0])?.timezone ?? "Asia/Kolkata";
  const many = locations.length > 1 && !locationId;
  const bookingCount = (n: number) => `${n} ${n === 1 ? "booking" : "bookings"}`;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Today</h1>
          <p className="mt-1 text-muted-foreground">{formatDayLong(localDateOf(now, tz))}</p>
        </div>
        <LocationFilter locations={locations} value={locationId} />
      </div>

      <ul aria-label="Today in numbers" className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label="Waiting for you"
          value={String(o.pendingCount)}
          hint={o.pendingCount === 1 ? "request to answer" : "requests to answer"}
          href="/dashboard/requests"
        />
        <Stat label="Requests today" value={String(o.todayRequests)} hint="online requests received" />
        <Stat label="Confirmed today" value={String(o.todayConfirmed)} hint="bookings for today" />
        <Stat label="Booking value" value={formatInr(o.todayBookingValue)} hint="today's confirmed bookings, not yet money in hand" />
        <Stat label="Collected today" value={formatInr(o.todayCollected)} hint="payments recorded, less refunds" />
        <Stat label="Cancelled today" value={String(o.todayCancelled)} hint={`${bookingCount(o.todayCancelled)} for today`} />
      </ul>

      <Section
        title="Waiting for an answer"
        action={
          o.pendingCount > 0 && (
            <Link href="/dashboard/requests" className="text-sm font-medium text-primary hover:underline">
              Review all
            </Link>
          )
        }
      >
        {o.pending.length === 0 ? (
          <Empty>No requests are waiting. New online requests appear here as they arrive.</Empty>
        ) : (
          <ul className="flex flex-col divide-y rounded-card border bg-card">
            {o.pending.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/dashboard/bookings/${b.id}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{b.customerName}</span>
                    <span className="tabular block text-sm text-muted-foreground">
                      {formatRange(b.startsAt, b.endsAt, b.timezone)}
                      {many && ` · ${b.locationName}`}
                    </span>
                  </span>
                  {b.pendingExpiresAt && <ExpiryCountdown expiresAt={b.pendingExpiresAt.toISOString()} />}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Still to come today">
        {o.upcoming.length === 0 ? (
          <Empty>No more confirmed bookings today.</Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {o.upcoming.map((b) => (
              <BookingRow key={b.id} booking={b} status={b.status} showLocation={many} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Right now">
        {o.resourcesNow.length === 0 ? (
          <Empty>No active resources at this location.</Empty>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {o.resourcesNow.map((r) => {
              const look = RESOURCE_LOOK[r.state];
              const Icon = look.icon;
              return (
                <li key={r.resourceId} className="flex items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3" data-state={r.state}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.name}</span>
                    {many && <span className="block truncate text-sm text-muted-foreground">{r.locationName}</span>}
                  </span>
                  <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", look.tone)}>
                    <Icon className="size-3.5" aria-hidden="true" />
                    {look.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}
