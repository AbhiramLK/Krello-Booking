import { CalendarDays } from "lucide-react";
import { getCalendarDay, getCalendarWeek } from "@krello/core";
import { addDays, localDateOf } from "@krello/booking-engine/time";
import { getDb } from "@/lib/db";
import { formatDayLong } from "@/lib/format";
import { requireTenant } from "@/lib/session";
import { firstParam } from "../schemas";
import { getLocations, getWritable } from "../tenant";
import { CalendarGrid } from "./calendar-grid";
import { CalendarToolbar } from "./calendar-toolbar";
import { weekStartOf } from "./geometry";
import { calendarParamsSchema } from "./schemas";
import { toDayView } from "./view-model";
import { WeekView } from "./week-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendar" };

/**
 * The venue's one operational calendar: online, phone and walk-in bookings
 * together, by day or by week, for one location at a time.
 */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireTenant("bookings.view");
  const sp = await searchParams;
  const params = calendarParamsSchema.parse({ location: firstParam(sp.location), date: firstParam(sp.date), view: firstParam(sp.view) });
  const [locations, writable] = await Promise.all([getLocations(ctx), getWritable(ctx.business.id)]);

  const location = locations.find((l) => l.id === params.location) ?? locations[0];
  if (!location) {
    return (
      <>
        <h1 className="text-3xl font-semibold tracking-tight">Calendar</h1>
        <p className="mt-6 rounded-card border bg-card p-5 text-[15px] text-muted-foreground">
          There is no location to show. Ask the owner to give you access to one.
        </p>
      </>
    );
  }

  const db = getDb();
  const today = localDateOf(new Date(), location.timezone);
  const date = params.date ?? today;
  const week = params.view === "week";
  const from = weekStartOf(date);

  const [day, weekDays] = await Promise.all([
    week ? null : getCalendarDay(db, ctx, { locationId: location.id, date }),
    week ? getCalendarWeek(db, ctx, { locationId: location.id, from }) : null,
  ]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-3xl font-semibold tracking-tight">
            <CalendarDays className="size-7 text-muted-foreground" aria-hidden="true" />
            Calendar
          </h1>
          <p className="tabular mt-1 text-muted-foreground">
            {week ? `${formatDayLong(from)} to ${formatDayLong(addDays(from, 6))}` : formatDayLong(date)}
          </p>
        </div>
      </div>

      <CalendarToolbar
        locations={locations.map((l) => ({ id: l.id, name: l.name }))}
        locationId={location.id}
        date={date}
        today={today}
        view={week ? "week" : "day"}
      />

      {day && (
        <CalendarGrid
          initial={toDayView(day)}
          locationName={location.name}
          canCreate={ctx.can("bookings.create_manual")}
          canBlock={ctx.can("blocks.manage")}
          writable={writable}
        />
      )}
      {weekDays && <WeekView days={weekDays} locationId={location.id} today={today} />}
    </>
  );
}
