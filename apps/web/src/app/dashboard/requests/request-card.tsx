import Link from "next/link";
import { Phone } from "lucide-react";
import { effectiveStatus, type BusinessBookingListItem, type DecisionAction } from "@krello/core";
import { ExpiryCountdown } from "@/components/dashboard/expiry-countdown";
import { StatusBadge } from "@/components/status-badge";
import { formatInr, formatRange, formatTime } from "@/lib/format";
import { BookingActions } from "../bookings/[id]/booking-actions";

/** `tel:` target for a stored phone number. */
export const telHref = (phone: string) => `tel:${phone.replace(/[^+\d]/g, "")}`;

/**
 * One pending request, with everything needed to decide on it. An overdue
 * request is shown as expired with no buttons: the engine would refuse it.
 */
export function RequestCard({
  booking: b,
  actions,
  writable,
  showLocation,
  now,
}: {
  booking: BusinessBookingListItem;
  actions: DecisionAction[];
  writable: boolean;
  showLocation: boolean;
  now: Date;
}) {
  const status = effectiveStatus(b, now);
  const headingId = `request-${b.id}`;
  return (
    <li>
      <article aria-labelledby={headingId} className="rounded-card border bg-card p-4 sm:p-5" data-status={status}>
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <h2 id={headingId} className="truncate text-lg font-semibold">
              {b.customerName}
            </h2>
            {b.customerPhone && (
              <a href={telHref(b.customerPhone)} className="tabular mt-0.5 inline-flex items-center gap-1.5 text-[15px] font-medium text-primary hover:underline">
                <Phone className="size-3.5" aria-hidden="true" />
                {b.customerPhone}
              </a>
            )}
          </div>
          {status === "pending" && b.pendingExpiresAt ? <ExpiryCountdown expiresAt={b.pendingExpiresAt.toISOString()} /> : <StatusBadge status={status} />}
        </div>

        <dl className="mt-3 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[15px]">
          <dt className="text-muted-foreground">When</dt>
          <dd className="tabular">{formatRange(b.startsAt, b.endsAt, b.timezone)}</dd>
          <dt className="text-muted-foreground">Booked</dt>
          <dd>
            {b.items.map((i) => (i.units > 1 ? `${i.name} × ${i.units}` : i.name)).join(", ")}
            {showLocation && <span className="text-muted-foreground"> · {b.locationName}</span>}
          </dd>
          <dt className="text-muted-foreground">People</dt>
          <dd className="tabular">{b.groupSize}</dd>
          <dt className="text-muted-foreground">Total</dt>
          <dd className="tabular font-semibold">{formatInr(b.totalAmount)}</dd>
          {b.customerNotes && (
            <>
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="whitespace-pre-line break-words">{b.customerNotes}</dd>
            </>
          )}
        </dl>

        {status === "pending" && b.pendingExpiresAt && (
          <p className="mt-3 text-sm text-muted-foreground">
            Answer by <span className="tabular">{formatTime(b.pendingExpiresAt, b.timezone)}</span> or the request expires and the slot is released.
          </p>
        )}
        {status === "expired" && <p className="mt-3 text-sm text-muted-foreground">The deadline passed before a decision, so this request can no longer be approved.</p>}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <BookingActions bookingId={b.id} actions={actions} disabled={!writable} customerName={b.customerName} />
          <Link href={`/dashboard/bookings/${b.id}`} className="text-sm font-medium text-primary hover:underline">
            Details<span className="sr-only"> for {b.customerName}</span>
          </Link>
        </div>
      </article>
    </li>
  );
}
