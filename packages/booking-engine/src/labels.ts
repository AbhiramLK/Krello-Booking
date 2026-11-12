/**
 * Client-safe booking vocabulary. No Node or database imports, so browser code
 * can import it from `@krello/booking-engine/labels`. `bookings.ts` re-exports
 * `STATUS_LABEL` and checks at compile time that the keys match the database enum.
 */
export type BookingStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled_by_customer"
  | "cancelled_by_business"
  | "completed"
  | "no_show";

export const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: "Awaiting venue response",
  approved: "Confirmed",
  rejected: "Declined",
  expired: "Expired",
  cancelled_by_customer: "Cancelled by customer",
  cancelled_by_business: "Cancelled by venue",
  completed: "Completed",
  no_show: "No-show",
};
