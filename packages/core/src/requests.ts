import { and, eq, isNull } from "drizzle-orm";
import { locations, users, SYSTEM_ACTOR, type Actor, type Db, type DbOrTx } from "@krello/database";
import {
  createBooking,
  EngineError,
  getAvailability,
  getTenantAccess,
  quoteBooking as priceWithEngine,
  transitionBooking,
  type AvailabilityResult,
  type BookingPriceSnapshot,
  type BookingRow,
  type BookingStatus,
} from "@krello/booking-engine";
import type { PriceSegment } from "@krello/pricing";
import { AppError, rateLimit, type UserRow } from "./auth";
import { getBookingByToken, getCustomerBooking, type CustomerBookingView } from "./bookings";

/** Submissions one phone number may make per hour. */
const SUBMISSIONS_PER_PHONE_PER_HOUR = 10;
/** Looser limit per network address, which many customers may share. */
const SUBMISSIONS_PER_IP_PER_HOUR = 30;

/**
 * The status a customer should see. A pending request whose deadline has
 * passed is expired, even before the expiry worker has recorded it.
 */
export function effectiveStatus(b: { status: BookingStatus; pendingExpiresAt: Date | null }, now: Date): BookingStatus {
  if (b.status === "pending" && b.pendingExpiresAt && b.pendingExpiresAt.getTime() <= now.getTime()) return "expired";
  return b.status;
}

/**
 * Slot availability for a public venue page. Locations of venues that are not
 * listed and bookable are reported as not found, so nothing leaks about them.
 */
export async function getPublicAvailability(db: DbOrTx, input: { locationId: string; date: string }): Promise<AvailabilityResult> {
  const [loc] = await db
    .select({ businessId: locations.businessId, status: locations.status })
    .from(locations)
    .where(eq(locations.id, input.locationId));
  if (!loc || loc.status !== "active" || !(await getTenantAccess(db, loc.businessId)).publicBookable) {
    throw new EngineError("not_found", "Location not found.");
  }
  return getAvailability(db, { locationId: input.locationId, date: input.date, audience: "customer" });
}

export interface BookingQuote {
  total: number;
  lines: { resourceId: string; name: string; amount: number; segments: PriceSegment[] }[];
}

/** Prices an online request without creating anything. Throws `EngineError` when a slot is not bookable. */
export async function quoteBooking(
  db: DbOrTx,
  input: { locationId: string; resourceIds: string[]; startsAt: Date; endsAt: Date; groupSize: number },
): Promise<BookingQuote> {
  const snapshot = await priceWithEngine(db, {
    locationId: input.locationId,
    resourceIds: input.resourceIds,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    groupSize: input.groupSize,
  });
  return toBookingQuote(snapshot);
}

/** The price of a selection as the dashboard and the booking page show it. */
export function toBookingQuote(snapshot: BookingPriceSnapshot): BookingQuote {
  return {
    total: snapshot.total,
    lines: snapshot.allocations.map((a) => ({
      resourceId: a.resourceId,
      name: a.resourceName,
      amount: a.price.total,
      segments: a.price.segments,
    })),
  };
}

export interface SubmitBookingRequestInput {
  user: UserRow;
  locationId: string;
  resourceIds: string[];
  startsAt: Date;
  endsAt: Date;
  groupSize: number;
  name: string;
  email?: string;
  notes?: string;
  idempotencyKey: string;
  ip?: string;
}

/**
 * Sends an online booking request as the signed-in customer. The phone number
 * always comes from the verified account, never from the form. Repeating a
 * submission with the same idempotency key returns the original booking.
 */
export async function submitBookingRequest(db: Db, input: SubmitBookingRequestInput): Promise<{ statusToken: string; reference: string }> {
  const { user } = input;
  if (!user.phoneVerifiedAt) {
    throw new AppError("phone_unverified", "Verify your phone number before sending a request.", 403);
  }
  const okPhone = await rateLimit(db, `booking:phone:${user.phone}`, SUBMISSIONS_PER_PHONE_PER_HOUR, 3600);
  const okIp = input.ip ? await rateLimit(db, `booking:ip:${input.ip}`, SUBMISSIONS_PER_IP_PER_HOUR, 3600) : true;
  if (!okPhone || !okIp) {
    throw new AppError("rate_limited", "Too many requests in the last hour. Please try again later.", 429);
  }

  const name = input.name.trim();
  const { booking, statusToken } = await createBooking(db, {
    locationId: input.locationId,
    resourceIds: input.resourceIds,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    groupSize: input.groupSize,
    customer: { name, phone: user.phone, email: input.email, notes: input.notes, userId: user.id },
    source: "online",
    actor: { kind: "customer", userId: user.id },
    idempotencyKey: input.idempotencyKey,
  });

  if (!user.name && name) {
    await db
      .update(users)
      .set({ name, updatedAt: new Date() })
      .where(and(eq(users.id, user.id), isNull(users.name)));
  }
  return { statusToken, reference: booking.publicReference };
}

/**
 * Cancels on the customer's behalf. An overdue request is expired rather than
 * cancelled: the venue's deadline has passed, so the slot is already free.
 */
async function cancelAsCustomer(db: Db, booking: BookingRow, view: CustomerBookingView, actor: Actor, reason?: string) {
  if (booking.status === "pending" && view.status === "expired") {
    await transitionBooking(db, { bookingId: booking.id, action: "expire", actor: SYSTEM_ACTOR });
    throw new EngineError("invalid_transition", "This request has already expired, so there is nothing to cancel.", {
      status: "expired",
    });
  }
  await transitionBooking(db, { bookingId: booking.id, action: "cancel_by_customer", actor, reason });
}

const linkGone = () => new AppError("not_found", "This link is no longer valid.", 404);

/** Cancels the booking behind a status link. */
export async function cancelByToken(db: Db, token: string, reason?: string): Promise<CustomerBookingView> {
  const found = await getBookingByToken(db, token);
  if (!found) throw linkGone();
  await cancelAsCustomer(db, found.booking, found.view, { kind: "customer", userId: null }, reason);
  const after = await getBookingByToken(db, token);
  if (!after) throw linkGone();
  return after.view;
}

/** Cancels a signed-in customer's own booking. Someone else's booking is not found. */
export async function cancelOwnBooking(db: Db, userId: string, bookingId: string, reason?: string): Promise<CustomerBookingView> {
  const found = await getCustomerBooking(db, userId, bookingId);
  if (!found) throw new EngineError("not_found", "Booking not found.");
  await cancelAsCustomer(db, found.booking, found.view, { kind: "customer", userId }, reason);
  return (await getCustomerBooking(db, userId, bookingId))!.view;
}

/**
 * Looks a booking up for its status page. A request whose deadline has passed
 * is recorded as expired first, so "the slot is open again" is true when shown.
 */
export async function viewBookingByToken(db: Db, token: string) {
  const found = await getBookingByToken(db, token);
  if (found && found.booking.status === "pending" && found.view.status === "expired") {
    await transitionBooking(db, { bookingId: found.booking.id, action: "expire", actor: SYSTEM_ACTOR });
    return getBookingByToken(db, token);
  }
  return found;
}

/**
 * A signed-in customer's own booking for its page. As with `viewBookingByToken`,
 * an overdue request is recorded as expired first, so the slot really is free.
 */
export async function viewCustomerBooking(db: Db, userId: string, bookingId: string) {
  const found = await getCustomerBooking(db, userId, bookingId);
  if (found && found.booking.status === "pending" && found.view.status === "expired") {
    await transitionBooking(db, { bookingId: found.booking.id, action: "expire", actor: SYSTEM_ACTOR });
    return getCustomerBooking(db, userId, bookingId);
  }
  return found;
}
