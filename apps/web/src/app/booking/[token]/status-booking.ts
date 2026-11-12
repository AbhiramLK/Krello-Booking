import type { CustomerBookingView } from "@krello/core";
import type { StatusBooking } from "./status-view";

/**
 * The only shape that crosses to the browser for a booking status screen, built
 * field by field from the customer view. The booking row itself holds staff
 * notes and the phone number, so it is never passed along.
 */
export function toStatusBooking(v: CustomerBookingView): StatusBooking {
  return {
    reference: v.reference,
    status: v.status,
    customerName: v.customerName,
    groupSize: v.groupSize,
    startsAt: v.startsAt.toISOString(),
    endsAt: v.endsAt.toISOString(),
    pendingExpiresAt: v.pendingExpiresAt?.toISOString() ?? null,
    rejectionReason: v.rejectionReason,
    cancellationReason: v.cancellationReason,
    totalAmount: v.totalAmount,
    venue: v.venue,
    items: v.items,
    canCancel: v.canCancel,
    cancelDeadline: v.cancelDeadline?.toISOString() ?? null,
    cancellationReasonRequired: v.cancellationReasonRequired,
  };
}
