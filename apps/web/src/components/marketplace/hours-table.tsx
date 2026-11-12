import { minuteLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Window {
  dayOfWeek: number;
  opensMinute: number;
  closesMinute: number;
}

/** Monday first, as people read a week in India. Values are `dayOfWeek` numbers, 0 = Sunday. */
const WEEK = [
  { day: 1, name: "Monday" },
  { day: 2, name: "Tuesday" },
  { day: 3, name: "Wednesday" },
  { day: 4, name: "Thursday" },
  { day: 5, name: "Friday" },
  { day: 6, name: "Saturday" },
  { day: 0, name: "Sunday" },
];

/** `9:00 AM - 11:00 PM`. A closing time of 1440 reads as 12:00 AM. */
const windowLabel = (w: Window) => `${minuteLabel(w.opensMinute)} - ${minuteLabel(w.closesMinute)}`;

/**
 * Opening hours for the week. `today` is worked out on the server in the venue's timezone,
 * so the highlighted row is right wherever the visitor is.
 */
export function HoursTable({ hours, today }: { hours: Window[]; today: number }) {
  return (
    <dl className="grid gap-1">
      {WEEK.map(({ day, name }) => {
        const windows = hours.filter((h) => h.dayOfWeek === day).sort((a, b) => a.opensMinute - b.opensMinute);
        const isToday = day === today;
        return (
          <div
            key={day}
            className={cn(
              "grid grid-cols-[7.5rem_1fr] items-baseline gap-3 rounded-xl px-3 py-2 text-sm sm:grid-cols-[9rem_1fr]",
              isToday && "bg-primary/10 font-medium",
            )}
            aria-current={isToday ? "date" : undefined}
          >
            <dt className={cn(!isToday && "text-muted-foreground")}>
              {name}
              {isToday && <span className="ml-2 text-xs font-medium text-[#0058b0]">Today</span>}
            </dt>
            <dd className="tabular">
              {windows.length === 0 ? (
                <span className="text-muted-foreground">Closed</span>
              ) : (
                <span className="flex flex-wrap gap-x-4">
                  {windows.map((w) => (
                    <span key={`${w.opensMinute}-${w.closesMinute}`} className="whitespace-nowrap">
                      {windowLabel(w)}
                    </span>
                  ))}
                </span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
