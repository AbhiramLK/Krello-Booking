import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { listCustomerBookings } from "@krello/core";
import { StatusBadge } from "@/components/status-badge";
import { formatInr, formatRange } from "@/lib/format";

export type BookingListItem = Awaited<ReturnType<typeof listCustomerBookings>>[number];

/** One booking in the account list. The whole card links to the booking. */
export function BookingRow({ booking: b }: { booking: BookingListItem }) {
  return (
    <li>
      <Link
        href={`/account/bookings/${b.id}`}
        className="group flex items-center gap-3 rounded-card border bg-card p-4 transition-shadow hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 sm:p-5"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <h3 className="min-w-0 truncate text-base font-semibold">{b.businessName}</h3>
            <StatusBadge status={b.status} />
          </div>
          <p className="tabular mt-1 text-[15px]">{formatRange(b.startsAt, b.endsAt, b.timezone)}</p>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {b.items.join(", ")}
            {b.locality && ` · ${b.locality}`}
          </p>
          <p className="tabular mt-1 text-sm">
            <span className="font-medium">{formatInr(b.totalAmount)}</span>
            <span className="text-muted-foreground"> · pay at the venue</span>
          </p>
        </div>
        <ChevronRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>
    </li>
  );
}
