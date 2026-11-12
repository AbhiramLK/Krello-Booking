import { and, asc, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import { bookingAllocations, bookings, locations, resourceBlocks, resources, type Db, type DbOrTx } from "@krello/database";
import {
  addDays,
  createBlock,
  createBooking,
  EngineError,
  getAvailability,
  isValidDate,
  loadDayContext,
  localDateOf,
  localToInstant,
  minuteOfDate,
  quoteBooking,
  removeBlock,
  type BookingRow,
  type BookingStatus,
  type DayContext,
  type SlotView,
} from "@krello/booking-engine";
import { AppError, normalisePhone, type Permission, type TenantContext } from "./auth";
import { effectiveStatus, toBookingQuote, type BookingQuote } from "./requests";

// The venue's operational calendar. Every function takes the member's
// TenantContext: the business comes from it, and a location or resource is
// looked up under that business and checked against the member's locations
// before anything is read or written. Bookings and blocks are written only by
// the booking engine.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MINUTES = 24 * 60;

const forbidden = () => new AppError("forbidden", "You do not have permission to do that.", 403);

function requirePermission(ctx: TenantContext, permission: Permission) {
  if (!ctx.can(permission)) throw forbidden();
}

/**
 * The location, if it belongs to the member's business and is one they may
 * open. Anything else is "not found": an owner's access covers every location
 * of their own business, so the business is checked here, not just the list.
 */
async function openLocation(db: DbOrTx, ctx: TenantContext, locationId: string) {
  const none = () => new EngineError("not_found", "Location not found.");
  if (typeof locationId !== "string" || !UUID.test(locationId)) throw none();
  const [loc] = await db
    .select({ id: locations.id, timezone: locations.timezone })
    .from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.businessId, ctx.business.id), eq(locations.status, "active")));
  if (!loc || !ctx.canAccessLocation(loc.id)) throw none();
  return loc;
}

function requireDate(date: string) {
  if (typeof date !== "string" || !isValidDate(date)) throw new EngineError("validation", "Invalid date.");
}

/* ---------- a day ---------- */

export interface CalendarResource {
  id: string;
  name: string;
  bookingMode: "exclusive" | "shared";
  capacity: number;
  slots: SlotView[];
}

export interface CalendarBooking {
  id: string;
  reference: string;
  customerName: string;
  /** Pending requests past their deadline read as expired, as everywhere else. */
  status: BookingStatus;
  source: BookingRow["source"];
  paymentStatus: BookingRow["paymentStatus"];
  startsAt: Date;
  endsAt: Date;
  /** Every resource the booking holds: it appears on each of their rows. */
  resourceIds: string[];
  groupSize: number;
  /** For the quick view. Shown to the venue's members only. */
  customerPhone: string | null;
  /** In paise. This is the booking's value, not money collected. */
  totalAmount: number;
  /** Places taken per resource: 1 for an exclusive one. */
  items: { resourceId: string; name: string; units: number }[];
}

export interface CalendarBlock {
  id: string;
  resourceId: string;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
}

export interface CalendarDay {
  locationId: string;
  date: string;
  timezone: string;
  resources: CalendarResource[];
  bookings: CalendarBooking[];
  blocks: CalendarBlock[];
}

/**
 * One local day at a location: each resource's slots as the venue sees them
 * (no customer notice or advance limits), the bookings that hold them, and the
 * blocks. Bookings are those that still hold a slot: requests awaiting an
 * answer, confirmed bookings, and completed or no-show ones. Cancelled, declined
 * and expired ones have released theirs. Slots can run past midnight, so a
 * booking or block that overlaps the day is included.
 */
export async function getCalendarDay(
  db: DbOrTx,
  ctx: TenantContext,
  input: { locationId: string; date: string },
  opts: { now?: Date } = {},
): Promise<CalendarDay> {
  requirePermission(ctx, "bookings.view");
  const loc = await openLocation(db, ctx, input.locationId);
  requireDate(input.date);
  const now = opts.now ?? new Date();

  const availability = await getAvailability(db, { locationId: loc.id, date: input.date, audience: "business", now });
  const slots = availability.resources.flatMap((r) => r.slots);
  // The last slot of the day may end after midnight.
  const from = localToInstant(input.date, 0, loc.timezone);
  const to = new Date(
    Math.max(localToInstant(input.date, DAY_MINUTES, loc.timezone).getTime(), ...slots.map((s) => new Date(s.endsAt).getTime())),
  );

  const [allocations, blockRows] = await Promise.all([
    db
      .select({
        booking: bookings,
        resourceId: bookingAllocations.resourceId,
        resourceName: resources.name,
        units: bookingAllocations.units,
      })
      .from(bookingAllocations)
      .innerJoin(bookings, eq(bookings.id, bookingAllocations.bookingId))
      .innerJoin(resources, eq(resources.id, bookingAllocations.resourceId))
      .where(
        and(
          eq(bookingAllocations.businessId, ctx.business.id),
          eq(bookingAllocations.locationId, loc.id),
          inArray(bookingAllocations.status, ["held", "confirmed"]),
          lt(bookingAllocations.startsAt, to),
          gt(bookingAllocations.endsAt, from),
        ),
      )
      .orderBy(asc(bookingAllocations.startsAt), asc(resources.sortOrder), asc(resources.name)),
    db
      .select({
        id: resourceBlocks.id,
        resourceId: resourceBlocks.resourceId,
        startsAt: resourceBlocks.startsAt,
        endsAt: resourceBlocks.endsAt,
        reason: resourceBlocks.reason,
      })
      .from(resourceBlocks)
      .innerJoin(resources, eq(resources.id, resourceBlocks.resourceId))
      .where(
        and(
          eq(resources.locationId, loc.id),
          eq(resourceBlocks.businessId, ctx.business.id),
          isNull(resourceBlocks.removedAt),
          lt(resourceBlocks.startsAt, to),
          gt(resourceBlocks.endsAt, from),
        ),
      )
      .orderBy(asc(resourceBlocks.startsAt)),
  ]);

  const byId = new Map<string, CalendarBooking>();
  for (const a of allocations) {
    const b = a.booking;
    let row = byId.get(b.id);
    if (!row) {
      row = {
        id: b.id,
        reference: b.publicReference,
        customerName: b.customerName,
        status: effectiveStatus(b, now),
        source: b.source,
        paymentStatus: b.paymentStatus,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        resourceIds: [],
        groupSize: b.groupSize,
        customerPhone: b.customerPhone,
        totalAmount: b.totalAmount,
        items: [],
      };
      byId.set(b.id, row);
    }
    row.resourceIds.push(a.resourceId);
    row.items.push({ resourceId: a.resourceId, name: a.resourceName, units: a.units });
  }

  return {
    locationId: loc.id,
    date: availability.date,
    timezone: availability.timezone,
    resources: availability.resources.map((r) => ({ id: r.resourceId, name: r.name, bookingMode: r.bookingMode, capacity: r.capacity, slots: r.slots })),
    bookings: [...byId.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.reference.localeCompare(b.reference)),
    blocks: blockRows,
  };
}

/* ---------- a week ---------- */

export interface CalendarWeekDay {
  date: string;
  /** Bookings starting that day that the venue has confirmed (approved, completed or no-show). */
  confirmed: number;
  /** Requests still waiting for an answer that start that day. */
  pending: number;
  /** Minutes of confirmed bookings, summed over resources; a shared resource counts by the share of its places taken. */
  bookedMinutes: number;
  /** Minutes the resources are open for booking, summed over resources, less blocked time. */
  availableMinutes: number;
}

type Span = [number, number];

/** Sorted, non-overlapping spans covering the same minutes. */
function merge(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const [s, e] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

function subtract(spans: Span[], holes: Span[]): Span[] {
  let out = spans;
  for (const [hs, he] of merge(holes)) {
    out = out.flatMap(([s, e]): Span[] => (he <= s || hs >= e ? [[s, e]] : [...(hs > s ? [[s, hs] as Span] : []), ...(he < e ? [[he, e] as Span] : [])]));
  }
  return out;
}

const length = (spans: Span[]) => spans.reduce((n, [s, e]) => n + (e - s), 0);

function intersectLength(spans: Span[], [s, e]: Span) {
  return length(spans.map(([a, b]): Span => [Math.max(a, s), Math.min(b, e)]).filter(([a, b]) => b > a));
}

/** Booked and available minutes for one loaded day. */
function dayMinutes(day: DayContext, tz: string): { booked: number; available: number } {
  let booked = 0;
  let available = 0;
  for (const r of day.resources) {
    const open = merge((day.slots.get(r.id) ?? []).map((s): Span => [s.startMinute, s.endMinute]));
    const blocked = day.blocks.filter((b) => b.resourceId === r.id).map((b): Span => [minuteOfDate(b.startsAt, day.date, tz), minuteOfDate(b.endsAt, day.date, tz)]);
    const usable = subtract(open, blocked);
    available += length(usable);
    for (const a of day.allocations) {
      if (a.resourceId !== r.id || a.status !== "confirmed") continue;
      const minutes = intersectLength(open, [minuteOfDate(a.startsAt, day.date, tz), minuteOfDate(a.endsAt, day.date, tz)]);
      booked += r.bookingMode === "shared" ? (minutes * a.units) / Math.max(r.capacity, 1) : minutes;
    }
  }
  return { booked: Math.round(booked), available };
}

/**
 * Seven days from `from`, for the week view: how many bookings and requests
 * each day holds, and how much of the time the resources are open was booked.
 */
export async function getCalendarWeek(
  db: DbOrTx,
  ctx: TenantContext,
  input: { locationId: string; from: string },
  opts: { now?: Date } = {},
): Promise<CalendarWeekDay[]> {
  requirePermission(ctx, "bookings.view");
  const loc = await openLocation(db, ctx, input.locationId);
  requireDate(input.from);
  const now = opts.now ?? new Date();
  const dates = Array.from({ length: 7 }, (_, i) => addDays(input.from, i));

  const [days, rows] = await Promise.all([
    Promise.all(dates.map((date) => loadDayContext(db, { locationId: loc.id, date }))),
    db
      .select({ status: bookings.status, startsAt: bookings.startsAt, pendingExpiresAt: bookings.pendingExpiresAt })
      .from(bookings)
      .where(
        and(
          eq(bookings.businessId, ctx.business.id),
          eq(bookings.locationId, loc.id),
          inArray(bookings.status, ["pending", "approved", "completed", "no_show"]),
          gt(bookings.startsAt, new Date(localToInstant(input.from, 0, loc.timezone).getTime() - 1)),
          lt(bookings.startsAt, localToInstant(addDays(input.from, 7), 0, loc.timezone)),
        ),
      ),
  ]);

  const counts = new Map<string, { confirmed: number; pending: number }>();
  for (const b of rows) {
    const status = effectiveStatus(b, now);
    if (status !== "pending" && status !== "approved" && status !== "completed" && status !== "no_show") continue;
    const date = localDateOf(b.startsAt, loc.timezone);
    const c = counts.get(date) ?? { confirmed: 0, pending: 0 };
    if (status === "pending") c.pending++;
    else c.confirmed++;
    counts.set(date, c);
  }

  return days.map((day) => {
    const { booked, available } = dayMinutes(day, loc.timezone);
    const c = counts.get(day.date);
    return { date: day.date, confirmed: c?.confirmed ?? 0, pending: c?.pending ?? 0, bookedMinutes: booked, availableMinutes: available };
  });
}

/* ---------- manual bookings ---------- */

export type ManualSource = "phone" | "walk_in" | "admin";

export interface ManualBookingInput {
  locationId: string;
  resourceIds: string[];
  startsAt: Date;
  endsAt: Date;
  source: ManualSource;
  name: string;
  phone?: string;
  groupSize: number;
  notes?: string;
  idempotencyKey: string;
}

const MANUAL_SOURCES: readonly string[] = ["phone", "walk_in", "admin"];

/**
 * A booking the venue's team enters for someone who phoned or walked in. It
 * goes through the same engine as an online request, so it meets the same
 * rules and cannot double-book, but it starts approved.
 */
export async function createManualBooking(
  db: Db,
  ctx: TenantContext,
  input: ManualBookingInput,
): Promise<{ booking: BookingRow; replayed: boolean }> {
  requirePermission(ctx, "bookings.create_manual");
  if (!MANUAL_SOURCES.includes(input.source)) throw new AppError("validation", "Choose phone, walk-in or added by the venue.", 422);
  const loc = await openLocation(db, ctx, input.locationId);

  const rawPhone = input.phone?.trim();
  const phone = rawPhone ? normalisePhone(rawPhone) : null;
  if (rawPhone && !phone) throw new AppError("invalid_phone", "Enter a valid 10-digit Indian mobile number.", 422);
  const name = input.name?.trim() || (input.source === "walk_in" ? "Walk-in" : "");

  const { booking, replayed } = await createBooking(db, {
    locationId: loc.id,
    resourceIds: input.resourceIds,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    groupSize: input.groupSize,
    customer: { name, phone, notes: input.notes },
    source: input.source,
    actor: { kind: "business", userId: ctx.user.id },
    idempotencyKey: input.idempotencyKey,
  });
  // A repeated key hands back the earlier booking; it must be one this member may see.
  if (replayed && (booking.businessId !== ctx.business.id || !ctx.canAccessLocation(booking.locationId))) {
    throw new EngineError("not_found", "Location not found.");
  }
  return { booking, replayed };
}

/**
 * The price of a manual booking before it is saved, by the engine's own checks
 * and rules. Fails as the booking would, for example when the slot is taken.
 */
export async function quoteManualBooking(
  db: DbOrTx,
  ctx: TenantContext,
  input: { locationId: string; resourceIds: string[]; startsAt: Date; endsAt: Date; groupSize: number },
): Promise<BookingQuote> {
  requirePermission(ctx, "bookings.create_manual");
  const loc = await openLocation(db, ctx, input.locationId);
  const snapshot = await quoteBooking(db, {
    locationId: loc.id,
    resourceIds: input.resourceIds,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    groupSize: input.groupSize,
    audience: "business",
  });
  return toBookingQuote(snapshot);
}

/* ---------- blocks ---------- */

const resourceGone = () => new EngineError("not_found", "Resource not found.");

/** Blocks a resource for a period. The engine refuses while live bookings overlap, and says how many. */
export async function blockResource(
  db: Db,
  ctx: TenantContext,
  input: { resourceId: string; startsAt: Date; endsAt: Date; reason?: string },
) {
  requirePermission(ctx, "blocks.manage");
  if (typeof input.resourceId !== "string" || !UUID.test(input.resourceId)) throw resourceGone();
  const [resource] = await db
    .select({ locationId: resources.locationId })
    .from(resources)
    .where(and(eq(resources.id, input.resourceId), eq(resources.businessId, ctx.business.id)));
  if (!resource || !ctx.canAccessLocation(resource.locationId)) throw resourceGone();
  return createBlock(db, {
    businessId: ctx.business.id,
    resourceId: input.resourceId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    reason: input.reason,
    actor: { kind: "business", userId: ctx.user.id },
  });
}

/** Lifts a block, freeing the slots under it. */
export async function unblockResource(db: Db, ctx: TenantContext, blockId: string): Promise<void> {
  requirePermission(ctx, "blocks.manage");
  const gone = () => new EngineError("not_found", "Block not found.");
  if (typeof blockId !== "string" || !UUID.test(blockId)) throw gone();
  const [row] = await db
    .select({ locationId: resources.locationId })
    .from(resourceBlocks)
    .innerJoin(resources, eq(resources.id, resourceBlocks.resourceId))
    .where(and(eq(resourceBlocks.id, blockId), eq(resourceBlocks.businessId, ctx.business.id)));
  if (!row || !ctx.canAccessLocation(row.locationId)) throw gone();
  await removeBlock(db, { businessId: ctx.business.id, blockId, actor: { kind: "business", userId: ctx.user.id } });
}
