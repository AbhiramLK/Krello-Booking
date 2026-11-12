"use client";

import { useId } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, isValidDate } from "@krello/booking-engine/time";
import { LocationFilter } from "@/components/dashboard/location-filter";
import { cn } from "@/lib/utils";
import { calendarHref, type CalendarView } from "./geometry";

const PILL =
  "inline-flex h-10 items-center justify-center rounded-full bg-card px-4 text-sm font-medium shadow-xs ring-1 ring-border transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * Where the calendar is looking: location, day or week, and the date. All of
 * it lives in the address, so a view can be bookmarked and the back button works.
 */
export function CalendarToolbar({
  locations,
  locationId,
  date,
  today,
  view,
}: {
  locations: { id: string; name: string }[];
  locationId: string;
  date: string;
  /** The location's own current date, so "Today" is right whatever the browser's timezone. */
  today: string;
  view: CalendarView;
}) {
  const router = useRouter();
  const pickerId = useId();
  const step = view === "week" ? 7 : 1;
  const unit = view === "week" ? "week" : "day";
  const href = (d: string, v: CalendarView = view) => calendarHref({ location: locationId, date: d, view: v });

  return (
    <div className="mt-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <LocationFilter locations={locations} value={locationId} allowAll={false} />

        <nav aria-label="Change date" className="flex items-center gap-1.5">
          <Link href={href(addDays(date, -step))} className={cn(PILL, "w-10 px-0")} aria-label={`Previous ${unit}`}>
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Link>
          <Link href={href(today)} className={PILL} aria-current={date === today ? "date" : undefined}>
            Today
          </Link>
          <Link href={href(addDays(date, step))} className={cn(PILL, "w-10 px-0")} aria-label={`Next ${unit}`}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        </nav>

        <div>
          <label htmlFor={pickerId} className="sr-only">
            Go to date
          </label>
          <input
            id={pickerId}
            type="date"
            value={date}
            onChange={(e) => {
              if (isValidDate(e.target.value)) router.push(href(e.target.value));
            }}
            className="tabular h-10 rounded-full bg-card px-4 text-sm font-medium shadow-xs ring-1 ring-border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>

        <nav aria-label="Calendar view" className="ml-auto flex rounded-full bg-muted p-1">
          {(["day", "week"] as const).map((v) => (
            <Link
              key={v}
              href={href(date, v)}
              aria-current={view === v ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center rounded-full px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2",
                view === v ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "day" ? "Day" : "Week"}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
