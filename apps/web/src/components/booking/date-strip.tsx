"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface DateStripProps {
  /** Calendar dates, YYYY-MM-DD, starting today in the venue's timezone. */
  dates: string[];
  value: string;
  onChange: (date: string) => void;
  disabled?: boolean;
}

function dayParts(date: string) {
  const out: Record<string, string> = {};
  const d = new Date(`${date}T12:00:00Z`);
  for (const p of new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).formatToParts(d)) {
    out[p.type] = p.value;
  }
  return out as { weekday: string; day: string; month: string };
}

/** A horizontal row of days, from today to the furthest day open for booking. */
export function DateStrip({ dates, value, onChange, disabled }: DateStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Keep the chosen day in view. Scrolls the strip only, never the page.
  useEffect(() => {
    const strip = stripRef.current;
    const button = selectedRef.current;
    if (!strip || !button) return;
    const left = button.offsetLeft;
    if (left < strip.scrollLeft || left + button.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: Math.max(0, left - 8) });
    }
  }, [value]);

  return (
    <div ref={stripRef} role="group" aria-label="Date" className="relative -mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
      {dates.map((date, i) => {
        const p = dayParts(date);
        const selected = date === value;
        const name = i === 0 ? "Today" : i === 1 ? "Tomorrow" : p.weekday;
        return (
          <button
            key={date}
            ref={selected ? selectedRef : undefined}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            aria-label={`${i === 0 ? "Today, " : i === 1 ? "Tomorrow, " : ""}${p.weekday} ${p.day} ${p.month}`}
            onClick={() => onChange(date)}
            className={cn(
              "flex w-[4.25rem] shrink-0 snap-start flex-col items-center rounded-xl border px-1 py-2 text-center outline-none transition-colors",
              "focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
              selected ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted/60",
            )}
          >
            <span className={cn("text-[11px] font-medium", selected ? "text-background/80" : "text-muted-foreground")}>{name}</span>
            <span className="tabular text-lg font-semibold leading-tight">{p.day}</span>
            <span className={cn("text-[11px]", selected ? "text-background/80" : "text-muted-foreground")}>
              {p.month}
            </span>
          </button>
        );
      })}
    </div>
  );
}
