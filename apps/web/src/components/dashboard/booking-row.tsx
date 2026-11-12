import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { BusinessBookingListItem } from "@krello/core";
import type { BookingStatus } from "@krello/booking-engine/labels";
import { PaymentBadge, StatusBadge } from "@/components/status-badge";
import { formatInr, formatRange } from "@/lib/format";

/** One booking in a dashboard list. The whole row opens the booking. Server component. */
export function BookingRow({ booking: b, status, showLocation }: { booking: BusinessBookingListItem; status: BookingStatus; showLocation: boolean }) {
  return (
    <li>
      <Link
        href={`/dashboard/bookings/${b.id}`}
        className="group flex items-center gap-3 rounded-card border bg-card p-4 transition-shadow hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <p className="min-w-0 truncate font-semibold">{b.customerName}</p>
            <span className="flex flex-wrap gap-1.5">
              <StatusBadge status={status} />
              {status !== "pending" && status !== "expired" && status !== "rejected" && <PaymentBadge status={b.paymentStatus} />}
            </span>
          </div>
          <p className="tabular mt-1 text-[15px]">{formatRange(b.startsAt, b.endsAt, b.timezone)}</p>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {b.items.map((i) => i.name).join(", ")}
            {showLocation && ` · ${b.locationName}`}
            <span className="tabular"> · {b.groupSize} {b.groupSize === 1 ? "person" : "people"}</span>
          </p>
          <p className="tabular mt-1 text-sm">
            <span className="font-medium">{formatInr(b.totalAmount)}</span>
            <span className="text-muted-foreground"> · {b.publicReference}</span>
          </p>
        </div>
        <ChevronRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>
    </li>
  );
}
