import { and, asc, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { bookings, locations, payments, users, type Db, type DbOrTx } from "@krello/database";
import { EngineError, recordPayment, type BookingStatus } from "@krello/booking-engine";
import { AppError, type Permission, type TenantContext } from "./auth";

// Money taken (or handed back) at the venue, and the report built from it.
// The ledger arithmetic, the amount-due limit and idempotency live in the
// booking engine's recordPayment; this layer adds the member's permission,
// their location access and the parsing of rupees typed into a form.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_LOCATION = "00000000-0000-0000-0000-000000000000";

export const PAYMENT_METHODS = ["cash", "upi", "card", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type CollectionKind = "collection" | "refund";

/** Bookings the venue has confirmed, whether or not the customer came. Only these can owe money. */
const CONFIRMED: BookingStatus[] = ["approved", "completed", "no_show"];
const CANCELLED: BookingStatus[] = ["cancelled_by_customer", "cancelled_by_business"];

const REFERENCE_MAX = 100;
const NOTES_MAX = 500;
const KEY_MAX = 100;
/** Nine digits of rupees keeps paise exact in a JavaScript number and well inside the column. */
const RUPEES = /^\d{1,9}(\.\d{1,2})?$/;

const forbidden = () => new AppError("forbidden", "You do not have permission to do that.", 403);
const invalid = (message: string) => new AppError("validation", message, 422);

/**
 * Whole rupees or rupees and paise ("150", "150.5", "150.50") as integer
 * paise. Anything else, including zero and negatives, is a validation error.
 */
export function parseRupees(raw: string): number {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!RUPEES.test(text)) throw invalid("Enter an amount in rupees, like 150 or 150.50.");
  const [rupees = "0", paise = ""] = text.split(".");
  const amount = Number(rupees) * 100 + Number(paise.padEnd(2, "0"));
  if (amount <= 0) throw invalid("Enter an amount greater than zero.");
  return amount;
}

function requirePermission(ctx: TenantContext, permission: Permission) {
  if (!ctx.can(permission)) throw forbidden();
}

/**
 * Viewing the ledger and the report is part of taking payments: whoever may
 * record a collection may read what has been collected.
 */
const VIEW: Permission = "payments.record";

/* ---------- recording ---------- */

export interface CollectionInput {
  bookingId: string;
  kind: CollectionKind;
  /** What the member typed, in rupees. Parsed here, never trusted from the client as paise. */
  amountRupees: string;
  method: PaymentMethod;
  reference?: string;
  notes?: string;
  /** One per attempt, so a retry or a double click records a single payment. */
  idempotencyKey: string;
}

/**
 * Records a collection or a refund against a booking of the member's business
 * and locations. A booking outside them is "not found", never "forbidden".
 * The engine locks the booking and refuses a collection above the amount due
 * and a refund above the amount collected.
 */
export async function recordCollection(db: Db, ctx: TenantContext, input: CollectionInput) {
  if (input.kind !== "collection" && input.kind !== "refund") throw invalid("Choose whether this is a payment or a refund.");
  requirePermission(ctx, input.kind === "refund" ? "payments.refund" : "payments.record");

  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) throw invalid("Choose how it was paid.");
  const amount = parseRupees(input.amountRupees);
  const reference = typeof input.reference === "string" ? input.reference.trim() : "";
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  if (reference.length > REFERENCE_MAX) throw invalid(`Keep the reference to ${REFERENCE_MAX} characters or fewer.`);
  if (notes.length > NOTES_MAX) throw invalid(`Keep the note to ${NOTES_MAX} characters or fewer.`);
  if (typeof input.idempotencyKey !== "string" || !input.idempotencyKey || input.idempotencyKey.length > KEY_MAX) {
    throw invalid("This form is out of date. Reload the page and try again.");
  }

  const notFound = () => new EngineError("not_found", "Booking not found.");
  if (typeof input.bookingId !== "string" || !UUID.test(input.bookingId)) throw notFound();
  const [row] = await db
    .select({ locationId: bookings.locationId })
    .from(bookings)
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.businessId, ctx.business.id)));
  if (!row || !ctx.canAccessLocation(row.locationId)) throw notFound();

  const result = await recordPayment(db, {
    businessId: ctx.business.id,
    bookingId: input.bookingId,
    kind: input.kind,
    amount,
    method: input.method,
    reference: reference || null,
    notes: notes || null,
    actor: { kind: "business", userId: ctx.user.id },
    idempotencyKey: input.idempotencyKey,
  });
  // A replay returns the earlier payment. If that was for another booking the
  // key was reused, and this call recorded nothing: say so rather than succeed.
  if (result.payment.bookingId !== input.bookingId) {
    throw invalid("This form is out of date. Reload the page and try again.");
  }
  return result;
}

/* ---------- scope ---------- */

export interface CollectionRange {
  /** Inclusive. */
  from: Date;
  /** Exclusive. */
  to: Date;
  locationId?: string;
}

/**
 * Narrows bookings to the member's locations, and to one location if asked.
 * Null means nothing is visible: a location the member may not open (or that
 * is not in the business) gives empty figures, never the whole business.
 */
function bookingScope(ctx: TenantContext, locationId?: string): SQL | null | undefined {
  if (locationId !== undefined) {
    if (typeof locationId !== "string" || !UUID.test(locationId) || !ctx.canAccessLocation(locationId)) return null;
    return eq(bookings.locationId, locationId);
  }
  return ctx.locationIds ? inArray(bookings.locationId, ctx.locationIds.length ? ctx.locationIds : [NO_LOCATION]) : undefined;
}

const validDate = (d: unknown): d is Date => d instanceof Date && !Number.isNaN(d.getTime());

/* ---------- the ledger ---------- */

export interface CollectionFilters {
  /** Inclusive, on when the money was recorded. */
  from?: Date;
  /** Exclusive. */
  to?: Date;
  method?: PaymentMethod;
  locationId?: string;
  page?: number;
  pageSize?: number;
}

export interface LedgerRow {
  id: string;
  bookingId: string;
  /** The booking's reference, e.g. KRL-2K9F. */
  reference: string;
  customerName: string;
  kind: CollectionKind;
  /** Paise, always positive; `kind` says which way the money went. */
  amount: number;
  method: PaymentMethod;
  /** The payer's own reference, such as a UPI transaction id. */
  paymentReference: string | null;
  notes: string | null;
  recordedByName: string | null;
  collectedAt: Date;
  locationId: string;
  locationName: string;
  timezone: string;
}

/** Payments and refunds recorded by the member's venue, newest first. Staff see their own locations only. */
export async function listCollections(
  db: DbOrTx,
  ctx: TenantContext,
  filters: CollectionFilters = {},
): Promise<{ total: number; page: number; pageSize: number; items: LedgerRow[] }> {
  requirePermission(ctx, VIEW);
  const pageSize = Math.min(Math.max(Math.trunc(filters.pageSize ?? 25) || 25, 1), 200);
  const page = Math.max(Math.trunc(filters.page ?? 1) || 1, 1);
  const scope = bookingScope(ctx, filters.locationId);
  if (scope === null) return { total: 0, page, pageSize, items: [] };

  const where = and(
    eq(payments.businessId, ctx.business.id),
    eq(bookings.businessId, ctx.business.id),
    scope,
    validDate(filters.from) ? gte(payments.collectedAt, filters.from) : undefined,
    validDate(filters.to) ? lt(payments.collectedAt, filters.to) : undefined,
    filters.method && (PAYMENT_METHODS as readonly string[]).includes(filters.method) ? eq(payments.method, filters.method) : undefined,
  );
  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: payments.id,
        bookingId: payments.bookingId,
        reference: bookings.publicReference,
        customerName: bookings.customerName,
        kind: payments.kind,
        amount: payments.amount,
        method: payments.method,
        paymentReference: payments.reference,
        notes: payments.notes,
        recordedByName: users.name,
        collectedAt: payments.collectedAt,
        locationId: bookings.locationId,
        locationName: locations.name,
        timezone: locations.timezone,
      })
      .from(payments)
      .innerJoin(bookings, eq(bookings.id, payments.bookingId))
      .innerJoin(locations, eq(locations.id, bookings.locationId))
      .leftJoin(users, eq(users.id, payments.recordedBy))
      .where(where)
      .orderBy(desc(payments.collectedAt), desc(payments.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(payments)
      .innerJoin(bookings, eq(bookings.id, payments.bookingId))
      .where(where),
  ]);
  return { total: count?.n ?? 0, page, pageSize, items: rows };
}

/* ---------- the summary ---------- */

export interface CollectionSummary {
  /** Paise. Confirmed bookings starting in the range. This is not money collected. */
  bookingValue: number;
  /** Paise. Collections less refunds recorded in the range. */
  collected: number;
  /** Paise. Still to collect on the confirmed bookings starting in the range. */
  outstanding: number;
  /** Collections less refunds recorded in the range, per method. Adds up to `collected`. */
  byMethod: Record<PaymentMethod, number>;
  paidCount: number;
  partlyPaidCount: number;
  unpaidCount: number;
  /** Paise. Cancelled bookings starting in the range. In none of the figures above. */
  cancelledValue: number;
}

function emptySummary(): CollectionSummary {
  return {
    bookingValue: 0,
    collected: 0,
    outstanding: 0,
    byMethod: { cash: 0, upi: 0, card: 0, other: 0 },
    paidCount: 0,
    partlyPaidCount: 0,
    unpaidCount: 0,
    cancelledValue: 0,
  };
}

/**
 * Booking value, collected and outstanding for a period, kept apart because
 * they answer different questions: what was booked, what was taken, what is
 * still owed. Bookings count by when they start; payments by when they were
 * recorded. Staff see their own locations only.
 */
export async function getCollectionSummary(db: DbOrTx, ctx: TenantContext, range: CollectionRange): Promise<CollectionSummary> {
  requirePermission(ctx, VIEW);
  const out = emptySummary();
  const scope = bookingScope(ctx, range.locationId);
  if (scope === null || !validDate(range.from) || !validDate(range.to)) return out;

  const confirmed = inArray(bookings.status, CONFIRMED);
  const [[b], byMethod] = await Promise.all([
    db
      .select({
        value: sql<string>`coalesce(sum(${bookings.totalAmount}) filter (where ${confirmed}), 0)`.mapWith(Number),
        outstanding: sql<string>`coalesce(sum(greatest(${bookings.totalAmount} - ${bookings.amountCollected}, 0)) filter (where ${confirmed}), 0)`.mapWith(Number),
        paid: sql<number>`count(*) filter (where ${confirmed} and ${bookings.paymentStatus} = 'paid')::int`,
        partly: sql<number>`count(*) filter (where ${confirmed} and ${bookings.paymentStatus} = 'partially_paid')::int`,
        unpaid: sql<number>`count(*) filter (where ${confirmed} and ${bookings.paymentStatus} = 'unpaid')::int`,
        cancelled: sql<string>`coalesce(sum(${bookings.totalAmount}) filter (where ${inArray(bookings.status, CANCELLED)}), 0)`.mapWith(Number),
      })
      .from(bookings)
      .where(and(eq(bookings.businessId, ctx.business.id), scope, gte(bookings.startsAt, range.from), lt(bookings.startsAt, range.to))),
    db
      .select({
        method: payments.method,
        net: sql<string>`coalesce(sum(case when ${payments.kind} = 'refund' then -${payments.amount} else ${payments.amount} end), 0)`.mapWith(Number),
      })
      .from(payments)
      .innerJoin(bookings, eq(bookings.id, payments.bookingId))
      .where(
        and(
          eq(payments.businessId, ctx.business.id),
          eq(bookings.businessId, ctx.business.id),
          scope,
          gte(payments.collectedAt, range.from),
          lt(payments.collectedAt, range.to),
        ),
      )
      .groupBy(payments.method),
  ]);

  for (const row of byMethod) out.byMethod[row.method] = row.net;
  out.collected = Object.values(out.byMethod).reduce((sum, n) => sum + n, 0);
  out.bookingValue = b?.value ?? 0;
  out.outstanding = b?.outstanding ?? 0;
  out.paidCount = b?.paid ?? 0;
  out.partlyPaidCount = b?.partly ?? 0;
  out.unpaidCount = b?.unpaid ?? 0;
  out.cancelledValue = b?.cancelled ?? 0;
  return out;
}

/* ---------- who still owes ---------- */

export interface OutstandingBooking {
  id: string;
  reference: string;
  customerName: string;
  status: BookingStatus;
  paymentStatus: "unpaid" | "partially_paid" | "paid";
  startsAt: Date;
  endsAt: Date;
  /** Paise. */
  totalAmount: number;
  amountCollected: number;
  due: number;
  locationName: string;
  timezone: string;
}

/**
 * Confirmed bookings starting in the range that have not been paid in full,
 * soonest first. `total` counts them all; `items` is capped at `limit`.
 */
export async function listOutstandingBookings(
  db: DbOrTx,
  ctx: TenantContext,
  range: CollectionRange,
  opts: { limit?: number } = {},
): Promise<{ total: number; items: OutstandingBooking[] }> {
  requirePermission(ctx, VIEW);
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50) || 50, 1), 200);
  const scope = bookingScope(ctx, range.locationId);
  if (scope === null || !validDate(range.from) || !validDate(range.to)) return { total: 0, items: [] };

  const where = and(
    eq(bookings.businessId, ctx.business.id),
    scope,
    inArray(bookings.status, CONFIRMED),
    sql`${bookings.amountCollected} < ${bookings.totalAmount}`,
    gte(bookings.startsAt, range.from),
    lt(bookings.startsAt, range.to),
  );
  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: bookings.id,
        reference: bookings.publicReference,
        customerName: bookings.customerName,
        status: bookings.status,
        paymentStatus: bookings.paymentStatus,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        totalAmount: bookings.totalAmount,
        amountCollected: bookings.amountCollected,
        locationName: locations.name,
        timezone: locations.timezone,
      })
      .from(bookings)
      .innerJoin(locations, eq(locations.id, bookings.locationId))
      .where(where)
      .orderBy(asc(bookings.startsAt), asc(bookings.id))
      .limit(limit),
    db.select({ n: sql<number>`count(*)::int` }).from(bookings).where(where),
  ]);
  return { total: count?.n ?? 0, items: rows.map((r) => ({ ...r, due: r.totalAmount - r.amountCollected })) };
}
