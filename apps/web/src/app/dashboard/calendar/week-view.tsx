import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { CalendarWeekDay } from "@krello/core";
import { formatDateShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { calendarHref, utilisation } from "./geometry";

const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10} h`;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Seven days at a glance: bookings, requests waiting, and how full each day is. Each day opens its Day view. */
export function WeekView({ days, locationId, today }: { days: CalendarWeekDay[]; locationId: string; today: string }) {
  return (
    <section aria-label="Week at a glance" className="mt-5">
      <ul className="flex flex-col gap-2">
        {days.map((d) => {
          const pct = utilisation(d);
          const isToday = d.date === today;
          return (
            <li key={d.date}>
              <Link
                href={calendarHref({ location: locationId, date: d.date })}
                className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-card border bg-card p-4 transition-shadow hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1.2fr)_auto]"
              >
                <span className="min-w-0">
                  <span className="tabular block font-semibold">{formatDateShort(d.date)}</span>
                  {isToday && <span className="text-sm font-medium text-primary">Today</span>}
                </span>
                <ChevronRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:order-last" aria-hidden="true" />

                <span className="col-span-2 text-[15px] sm:col-span-1">
                  <span className="tabular">{count(d.confirmed, "confirmed booking", "confirmed bookings")}</span>
                  <span className={cn("tabular block", d.pending > 0 ? "font-medium text-[#8a5300]" : "text-muted-foreground")}>
                    {d.pending > 0 ? `${count(d.pending, "request", "requests")} waiting for an answer` : "No requests waiting"}
                  </span>
                </span>

                <span className="col-span-2 sm:col-span-1">
                  {pct === null ? (
                    <span className="text-sm text-muted-foreground">Nothing open to book</span>
                  ) : (
                    <>
                      <span
                        role="meter"
                        aria-label="Share of open time that is booked"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={pct}
                        aria-valuetext={`${pct} percent booked`}
                        className="block h-2 overflow-hidden rounded-full bg-muted"
                      >
                        <span className="block h-full rounded-full bg-info" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="tabular mt-1 block text-sm text-muted-foreground">
                        {pct}% booked · {hours(d.bookedMinutes)} of {hours(d.availableMinutes)}
                      </span>
                    </>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
