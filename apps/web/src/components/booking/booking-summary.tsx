"use client";

import { Info } from "lucide-react";
import type { BookingQuote } from "@krello/core";
import { Skeleton } from "@/components/ui/skeleton";
import { durationLabel, formatInr, formatRange, timeZoneName } from "@/lib/format";

export type QuoteState =
  | { status: "loading" }
  /** `key` identifies the selection this price is for. */
  | { status: "ready"; quote: BookingQuote; key: string }
  | { status: "error"; message: string };

interface BookingSummaryProps {
  startsAt: string;
  endsAt: string;
  timezone: string;
  groupSize: number;
  quote: QuoteState;
  holdMinutes: number;
  policyLines: string[];
}

/** What will be requested, what it costs, and what happens next. */
export function BookingSummary({ startsAt, endsAt, timezone, groupSize, quote, holdMinutes, policyLines }: BookingSummaryProps) {
  return (
    <section aria-labelledby="booking-summary" className="rounded-2xl bg-muted/50 p-4">
      <h3 id="booking-summary" className="text-sm font-semibold">
        Your request
      </h3>
      <p className="tabular mt-1 text-[15px] font-medium">{formatRange(startsAt, endsAt, timezone)}</p>
      <p className="text-xs text-muted-foreground">
        {timeZoneName(startsAt, timezone)} · {groupSize} {groupSize === 1 ? "person" : "people"}
      </p>

      <div aria-live="polite" aria-busy={quote.status === "loading"} className="mt-3 border-t pt-3">
        {quote.status === "loading" && (
          <div className="space-y-2" aria-label="Working out the price">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        )}
        {quote.status === "error" && (
          <p role="alert" className="text-sm text-[#c4271d]">
            {quote.message}
          </p>
        )}
        {quote.status === "ready" && (
          <dl className="space-y-1.5 text-sm">
            {quote.quote.lines.map((line) => (
              <div key={line.resourceId} className="flex items-baseline justify-between gap-3">
                <dt className="min-w-0 truncate">{line.name}</dt>
                <dd className="tabular shrink-0">{formatInr(line.amount)}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3 border-t pt-2 font-semibold">
              <dt>Total</dt>
              <dd className="tabular text-base">{formatInr(quote.quote.total)}</dd>
            </div>
            <p className="text-xs text-muted-foreground">Pay at the venue. Nothing is charged online.</p>
          </dl>
        )}
      </div>

      <div className="mt-3 flex gap-2.5 rounded-xl bg-card p-3 text-[13px] leading-snug">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium">This is a request. Your booking is confirmed only when the venue approves it.</p>
          <p className="text-muted-foreground">
            The venue has up to {durationLabel(holdMinutes)} to respond. Your slot is held for you until then.
          </p>
        </div>
      </div>

      <div className="mt-3 text-[13px]">
        <h4 className="font-medium">Booking and cancellation</h4>
        <ul className="mt-2 space-y-1.5 leading-snug text-muted-foreground">
          {policyLines.map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground" />
              {line}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
