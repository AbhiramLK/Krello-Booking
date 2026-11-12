import type { BookingStatus } from "@krello/booking-engine/labels";
import { formatTime } from "../../../lib/format";
import type { BookingView } from "./view-model";

/** Short status words for blocks on the grid. Status is always written out, never only a colour. */
export const STATUS_WORD: Record<BookingStatus, string> = {
  pending: "Pending",
  approved: "Confirmed",
  rejected: "Declined",
  expired: "Expired",
  cancelled_by_customer: "Cancelled",
  cancelled_by_business: "Cancelled",
  completed: "Completed",
  no_show: "No-show",
};

export const SOURCE_WORD: Record<BookingView["source"], string> = {
  online: "Online",
  phone: "Phone",
  walk_in: "Walk-in",
  admin: "Added by venue",
};

/** Statuses a booking on the calendar can have, for the filter. */
export const CALENDAR_STATUSES = ["approved", "pending", "completed", "no_show", "expired"] as const;

/** Whether a booking has been confirmed by the venue, so a payment status means something. */
export const isConfirmed = (status: BookingStatus) => status === "approved" || status === "completed" || status === "no_show";

/**
 * One line about a booking in a shared slot's list: places, times and its real
 * status word. Shared lanes draw no booking blocks, so this is the only place
 * staff see a shared booking's status.
 */
export function slotBookingLine(b: BookingView, resourceId: string, tz: string): string {
  const places = b.items.find((i) => i.resourceId === resourceId)?.units ?? 1;
  return `${places} ${places === 1 ? "place" : "places"} · ${formatTime(b.startsAt, tz)} – ${formatTime(b.endsAt, tz)} · ${STATUS_WORD[b.status]}`;
}
