import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import {
  bookingAllocations,
  bookingStatusHistory,
  bookings,
  businesses,
  locations,
  payments,
  resources,
  reviews,
  users,
  type DbOrTx,
} from "@krello/database";
import { describePolicy, hashToken, resolvePolicy, type BookingRow, type BookingStatus } from "@krello/booking-engine";

const TOKEN_LIFETIME_AFTER_END_MS = 30 * 86_400_000;

async function allocationsFor(db: DbOrTx, bookingIds: string[]) {
  if (!bookingIds.length) return [];
  return db
    .select({
      bookingId: bookingAllocations.bookingId,
      resourceId: bookingAllocations.resourceId,
      resourceName: resources.name,
      resourceType: resources.resourceType,
      startsAt: bookingAllocations.startsAt,
      endsAt: bookingAllocations.endsAt,
      units: bookingAllocations.units,
      status: bookingAllocations.status,
    })
    .from(bookingAllocations)
    .innerJoin(resources, eq(resources.id, bookingAllocations.resourceId))
    .where(inArray(bookingAllocations.bookingId, bookingIds))
    .orderBy(asc(resources.sortOrder), asc(resources.name));
}

/**
 * What a customer may see about a booking. Deliberately leaves out internal
 * notes, staff identities and other customers' data.
 */
async function toCustomerView(db: DbOrTx, b: BookingRow, now: Date) {
  const [[venue], allocs, [review]] = await Promise.all([
    db
      .select({
        businessName: businesses.name,
        businessSlug: businesses.slug,
        businessPhone: businesses.contactPhone,
        policy: businesses.policy,
        locationName: locations.name,
        address: locations.address,
        locality: locations.locality,
        city: locations.city,
        locationPhone: locations.phone,
        timezone: locations.timezone,
      })
      .from(locations)
      .innerJoin(businesses, eq(businesses.id, locations.businessId))
      .where(eq(locations.id, b.locationId)),
    allocationsFor(db, [b.id]),
    db.select({ id: reviews.id, rating: reviews.rating, body: reviews.body }).from(reviews).where(eq(reviews.bookingId, b.id)),
  ]);
  const policy = resolvePolicy(venue?.policy);
  const cancelDeadline = new Date(b.startsAt.getTime() - policy.cancellationDeadlineMinutes * 60000);
  const canCancel =
    (b.status === "pending" && policy.customerCanCancelPending) ||
    (b.status === "approved" && policy.customerCanCancelApproved && now.getTime() <= cancelDeadline.getTime());

  return {
    id: b.id,
    reference: b.publicReference,
    status: b.status,
    source: b.source,
    customerName: b.customerName,
    groupSize: b.groupSize,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    requestedAt: b.requestedAt,
    pendingExpiresAt: b.pendingExpiresAt,
    rejectionReason: b.rejectionReason,
    cancellationReason: b.cancellationReason,
    totalAmount: b.totalAmount,
    amountCollected: b.amountCollected,
    paymentStatus: b.paymentStatus,
    venue: {
      name: venue?.businessName ?? "",
      slug: venue?.businessSlug ?? "",
      phone: venue?.locationPhone ?? venue?.businessPhone ?? null,
      locationName: venue?.locationName ?? "",
      address: venue ? `${venue.address}, ${venue.locality}, ${venue.city}` : "",
      timezone: venue?.timezone ?? "Asia/Kolkata",
    },
    items: allocs.map((a) => ({ name: a.resourceName, type: a.resourceType, units: a.units })),
    policyLines: describePolicy(policy),
    canCancel,
    cancelDeadline: b.status === "approved" && policy.customerCanCancelApproved ? cancelDeadline : null,
    cancellationReasonRequired: policy.cancellationReasonRequired,
    canReview: b.status === "completed" && !review,
    review: review ?? null,
  };
}

export type CustomerBookingView = Awaited<ReturnType<typeof toCustomerView>>;

/** Looks a booking up by its secret status-link token. */
export async function getBookingByToken(db: DbOrTx, token: string, now = new Date()): Promise<{ booking: BookingRow; view: CustomerBookingView } | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const [b] = await db.select().from(bookings).where(eq(bookings.statusTokenHash, hashToken(token)));
  if (!b || b.statusTokenRevokedAt) return null;
  if (now.getTime() > b.endsAt.getTime() + TOKEN_LIFETIME_AFTER_END_MS) return null;
  return { booking: b, view: await toCustomerView(db, b, now) };
}

/** A signed-in customer's own booking. */
export async function getCustomerBooking(db: DbOrTx, userId: string, bookingId: string, now = new Date()) {
  const [b] = await db.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.customerUserId, userId)));
  return b ? { booking: b, view: await toCustomerView(db, b, now) } : null;
}

export async function listCustomerBookings(db: DbOrTx, userId: string) {
  const rows = await db
    .select({
      id: bookings.id,
      reference: bookings.publicReference,
      status: bookings.status,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      totalAmount: bookings.totalAmount,
      groupSize: bookings.groupSize,
      businessName: businesses.name,
      businessSlug: businesses.slug,
      locality: locations.locality,
      timezone: locations.timezone,
      reviewed: sql<boolean>`exists (select 1 from reviews rv where rv.booking_id = ${bookings.id})`,
    })
    .from(bookings)
    .innerJoin(businesses, eq(businesses.id, bookings.businessId))
    .innerJoin(locations, eq(locations.id, bookings.locationId))
    .where(eq(bookings.customerUserId, userId))
    .orderBy(desc(bookings.startsAt))
    .limit(200);
  const allocs = await allocationsFor(db, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, items: allocs.filter((a) => a.bookingId === r.id).map((a) => a.resourceName) }));
}

/* ---------- business side ---------- */

export interface BusinessBookingFilters {
  statuses?: BookingStatus[];
  /** Restrict to these locations (staff assignment). Null means all. */
  locationIds?: string[] | null;
  locationId?: string;
  resourceId?: string;
  source?: BookingRow["source"];
  paymentStatus?: BookingRow["paymentStatus"];
  from?: Date;
  to?: Date;
  q?: string;
  order?: "starts_asc" | "starts_desc" | "requested_desc" | "expires_asc";
  page?: number;
  pageSize?: number;
}

export async function listBusinessBookings(db: DbOrTx, businessId: string, f: BusinessBookingFilters = {}) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 200);
  const page = Math.max(f.page ?? 1, 1);
  const q = f.q?.trim();
  const where = and(
    eq(bookings.businessId, businessId),
    f.statuses?.length ? inArray(bookings.status, f.statuses) : undefined,
    f.locationIds ? inArray(bookings.locationId, f.locationIds.length ? f.locationIds : ["00000000-0000-0000-0000-000000000000"]) : undefined,
    f.locationId ? eq(bookings.locationId, f.locationId) : undefined,
    f.source ? eq(bookings.source, f.source) : undefined,
    f.paymentStatus ? eq(bookings.paymentStatus, f.paymentStatus) : undefined,
    f.from ? gte(bookings.endsAt, f.from) : undefined,
    f.to ? lt(bookings.startsAt, f.to) : undefined,
    f.resourceId
      ? sql`exists (select 1 from booking_allocations a where a.booking_id = ${bookings.id} and a.resource_id = ${f.resourceId})`
      : undefined,
    q
      ? or(
          ilike(bookings.customerName, `%${q}%`),
          ilike(bookings.customerPhone, `%${q.replace(/\D/g, "") || q}%`),
          ilike(bookings.publicReference, `%${q}%`),
        )
      : undefined,
  );
  const order =
    f.order === "starts_desc"
      ? desc(bookings.startsAt)
      : f.order === "requested_desc"
        ? desc(bookings.requestedAt)
        : f.order === "expires_asc"
          ? asc(bookings.pendingExpiresAt)
          : asc(bookings.startsAt);

  const [rows, [count]] = await Promise.all([
    db
      .select({ booking: bookings, locationName: locations.name, timezone: locations.timezone })
      .from(bookings)
      .innerJoin(locations, eq(locations.id, bookings.locationId))
      .where(where)
      .orderBy(order)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(bookings).where(where),
  ]);
  const allocs = await allocationsFor(db, rows.map((r) => r.booking.id));
  return {
    total: count?.n ?? 0,
    page,
    pageSize,
    items: rows.map((r) => {
      const { statusTokenHash: _t, idempotencyKey: _k, ...b } = r.booking;
      return {
        ...b,
        locationName: r.locationName,
        timezone: r.timezone,
        items: allocs.filter((a) => a.bookingId === b.id).map((a) => ({ resourceId: a.resourceId, name: a.resourceName, units: a.units })),
      };
    }),
  };
}

export type BusinessBookingListItem = Awaited<ReturnType<typeof listBusinessBookings>>["items"][number];

export async function getBusinessBooking(db: DbOrTx, businessId: string, bookingId: string) {
  const [row] = await db
    .select({ booking: bookings, locationName: locations.name, timezone: locations.timezone })
    .from(bookings)
    .innerJoin(locations, eq(locations.id, bookings.locationId))
    .where(and(eq(bookings.id, bookingId), eq(bookings.businessId, businessId)));
  if (!row) return null;
  const [allocs, history, ledger] = await Promise.all([
    allocationsFor(db, [bookingId]),
    db
      .select({
        fromStatus: bookingStatusHistory.fromStatus,
        toStatus: bookingStatusHistory.toStatus,
        actorKind: bookingStatusHistory.actorKind,
        actorName: users.name,
        reason: bookingStatusHistory.reason,
        createdAt: bookingStatusHistory.createdAt,
      })
      .from(bookingStatusHistory)
      .leftJoin(users, eq(users.id, bookingStatusHistory.actorUserId))
      .where(eq(bookingStatusHistory.bookingId, bookingId))
      .orderBy(asc(bookingStatusHistory.createdAt)),
    db
      .select({
        id: payments.id,
        kind: payments.kind,
        amount: payments.amount,
        method: payments.method,
        reference: payments.reference,
        notes: payments.notes,
        collectedAt: payments.collectedAt,
        recordedByName: users.name,
      })
      .from(payments)
      .leftJoin(users, eq(users.id, payments.recordedBy))
      .where(eq(payments.bookingId, bookingId))
      .orderBy(asc(payments.collectedAt)),
  ]);
  const { statusTokenHash: _t, idempotencyKey: _k, ...booking } = row.booking;
  return { booking, locationName: row.locationName, timezone: row.timezone, allocations: allocs, history, payments: ledger };
}
