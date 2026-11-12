import { and, eq, gt, gte, inArray, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { bookingAllocations, bookings, locations, payments, resourceBlocks, resources, type Db, type DbOrTx } from "@krello/database";
import {
  addDays,
  addInternalNote,
  EngineError,
  getTenantAccess,
  localDateOf,
  localToInstant,
  transitionBooking,
  type BookingStatus,
  type TransitionResult,
} from "@krello/booking-engine";
import { AppError, type Permission, type TenantContext } from "./auth";
import { getBusinessBooking, listBusinessBookings, type BusinessBookingFilters, type BusinessBookingListItem } from "./bookings";
import { countUnread } from "./notifications";
import { effectiveStatus } from "./requests";

// Every function here takes the member's TenantContext, so the business and
// the member's locations are always applied. Nothing reads a business id from
// anywhere else.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_LOCATION = "00000000-0000-0000-0000-000000000000";

/** Statuses whose booking value counts as expected business: confirmed, whether or not the customer came. */
const CONFIRMED: BookingStatus[] = ["approved", "completed", "no_show"];
const CANCELLED: BookingStatus[] = ["cancelled_by_customer", "cancelled_by_business"];

const forbidden = () => new AppError("forbidden", "You do not have permission to do that.", 403);
const notFound = () => new EngineError("not_found", "Booking not found.");

function requirePermission(ctx: TenantContext, permission: Permission) {
  if (!ctx.can(permission)) throw forbidden();
}

/** Restricts a bookings query to the member's assigned locations, if any. */
function locationScope(ctx: TenantContext): SQL | undefined {
  return ctx.locationIds ? inArray(bookings.locationId, ctx.locationIds.length ? ctx.locationIds : [NO_LOCATION]) : undefined;
}

export interface TenantLocation {
  id: string;
  name: string;
  timezone: string;
}

/** Active locations of the business the member may open, by name. */
export async function listTenantLocations(db: DbOrTx, ctx: TenantContext): Promise<TenantLocation[]> {
  const rows = await db
    .select({ id: locations.id, name: locations.name, timezone: locations.timezone })
    .from(locations)
    .where(and(eq(locations.businessId, ctx.business.id), eq(locations.status, "active")))
    .orderBy(locations.name);
  return rows.filter((l) => ctx.canAccessLocation(l.id));
}

/* ---------- overview ---------- */

export interface ResourceNow {
  resourceId: string;
  name: string;
  locationName: string;
  /** occupied: an approved booking covers this moment. blocked: a block does. */
  state: "free" | "occupied" | "blocked";
}

export interface Overview {
  /** Live requests awaiting a decision, whatever day they are for. Overdue ones are not counted. */
  pendingCount: number;
  /** Online requests received today, in any state. */
  todayRequests: number;
  /** Bookings for today that the venue confirmed (approved, completed or no-show). */
  todayConfirmed: number;
  /** Total value of today's confirmed bookings, in paise. This is not money collected. */
  todayBookingValue: number;
  /** Collections minus refunds recorded today, in paise. */
  todayCollected: number;
  /** Bookings for today that were cancelled, by either side. */
  todayCancelled: number;
  /** Today's approved bookings that have not ended, soonest first. */
  upcoming: BusinessBookingListItem[];
  /** Live requests, soonest deadline first. */
  pending: BusinessBookingListItem[];
  resourcesNow: ResourceNow[];
}

const LIST_LIMIT = 10;

/** Today's local day of each location, as an instant window. */
function todayWindows(locs: TenantLocation[], now: Date) {
  return locs.map((l) => {
    const today = localDateOf(now, l.timezone);
    return { ...l, start: localToInstant(today, 0, l.timezone), end: localToInstant(addDays(today, 1), 0, l.timezone) };
  });
}

type Window = ReturnType<typeof todayWindows>[number];

/** `column` falls on today's local day at the row's own location. */
function onToday(windows: Window[], locationColumn: typeof bookings.locationId, column: Parameters<typeof gte>[0]): SQL {
  return or(...windows.map((w) => and(eq(locationColumn, w.id), gte(column, w.start), lt(column, w.end))))!;
}

/**
 * The dashboard landing page: today's picture at the venue. "Today" is the
 * local day of each location. Staff assigned to some locations see figures for
 * those only; `locationId` narrows further, and a location the member may not
 * open gives empty figures, never the whole business.
 */
export async function getOverview(db: DbOrTx, ctx: TenantContext, opts: { locationId?: string; now?: Date } = {}): Promise<Overview> {
  requirePermission(ctx, "dashboard.view");
  const now = opts.now ?? new Date();
  const locs = (await listTenantLocations(db, ctx)).filter((l) => !opts.locationId || l.id === opts.locationId);
  if (!locs.length) {
    return {
      pendingCount: 0,
      todayRequests: 0,
      todayConfirmed: 0,
      todayBookingValue: 0,
      todayCollected: 0,
      todayCancelled: 0,
      upcoming: [],
      pending: [],
      resourcesNow: [],
    };
  }
  const windows = todayWindows(locs, now);
  const ids = locs.map((l) => l.id);
  const business = eq(bookings.businessId, ctx.business.id);
  const atLocations = inArray(bookings.locationId, ids);

  const [[day], [requests], [pendingRow], [collected], upcoming, pending, resourcesNow] = await Promise.all([
    db
      .select({
        confirmed: sql<number>`count(*) filter (where ${inArray(bookings.status, CONFIRMED)})::int`,
        value: sql<string>`coalesce(sum(${bookings.totalAmount}) filter (where ${inArray(bookings.status, CONFIRMED)}), 0)`.mapWith(Number),
        cancelled: sql<number>`count(*) filter (where ${inArray(bookings.status, CANCELLED)})::int`,
      })
      .from(bookings)
      .where(and(business, onToday(windows, bookings.locationId, bookings.startsAt))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(bookings)
      .where(and(business, eq(bookings.source, "online"), onToday(windows, bookings.locationId, bookings.requestedAt))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(bookings)
      .where(and(business, atLocations, eq(bookings.status, "pending"), gt(bookings.pendingExpiresAt, now))),
    db
      .select({
        net: sql<string>`coalesce(sum(case when ${payments.kind} = 'refund' then -${payments.amount} else ${payments.amount} end), 0)`.mapWith(Number),
      })
      .from(payments)
      .innerJoin(bookings, eq(bookings.id, payments.bookingId))
      .where(and(eq(payments.businessId, ctx.business.id), business, onToday(windows, bookings.locationId, payments.collectedAt))),
    listBusinessBookings(db, ctx.business.id, {
      statuses: ["approved"],
      locationIds: ids,
      from: now,
      to: new Date(Math.max(...windows.map((w) => w.end.getTime()))),
      order: "starts_asc",
      pageSize: 100,
    }).then((r) =>
      r.items
        .filter((b) => {
          const w = windows.find((x) => x.id === b.locationId);
          return w !== undefined && b.startsAt.getTime() < w.end.getTime();
        })
        .slice(0, LIST_LIMIT),
    ),
    listBusinessBookings(db, ctx.business.id, { statuses: ["pending"], locationIds: ids, order: "expires_asc", pageSize: 200 }).then((r) =>
      r.items.filter((b) => effectiveStatus(b, now) === "pending").slice(0, LIST_LIMIT),
    ),
    getResourcesNow(db, ctx.business.id, locs, now),
  ]);

  return {
    pendingCount: pendingRow?.n ?? 0,
    todayRequests: requests?.n ?? 0,
    todayConfirmed: day?.confirmed ?? 0,
    todayBookingValue: day?.value ?? 0,
    todayCollected: collected?.net ?? 0,
    todayCancelled: day?.cancelled ?? 0,
    upcoming,
    pending,
    resourcesNow,
  };
}

async function getResourcesNow(db: DbOrTx, businessId: string, locs: TenantLocation[], now: Date): Promise<ResourceNow[]> {
  const ids = locs.map((l) => l.id);
  const rows = await db
    .select({ id: resources.id, name: resources.name, locationId: resources.locationId })
    .from(resources)
    .where(and(eq(resources.businessId, businessId), inArray(resources.locationId, ids), eq(resources.status, "active")))
    .orderBy(resources.sortOrder, resources.name);
  if (!rows.length) return [];
  const resourceIds = rows.map((r) => r.id);

  const [blocked, occupied] = await Promise.all([
    db
      .select({ resourceId: resourceBlocks.resourceId })
      .from(resourceBlocks)
      .where(
        and(
          inArray(resourceBlocks.resourceId, resourceIds),
          isNull(resourceBlocks.removedAt),
          lte(resourceBlocks.startsAt, now),
          gt(resourceBlocks.endsAt, now),
        ),
      ),
    // Allocations stay "confirmed" after a booking is completed or marked a
    // no-show, so the booking's own status decides whether someone is there.
    db
      .select({ resourceId: bookingAllocations.resourceId })
      .from(bookingAllocations)
      .innerJoin(bookings, eq(bookings.id, bookingAllocations.bookingId))
      .where(
        and(
          inArray(bookingAllocations.resourceId, resourceIds),
          eq(bookingAllocations.status, "confirmed"),
          eq(bookings.status, "approved"),
          lte(bookingAllocations.startsAt, now),
          gt(bookingAllocations.endsAt, now),
        ),
      ),
  ]);
  const blockedIds = new Set(blocked.map((b) => b.resourceId));
  const occupiedIds = new Set(occupied.map((o) => o.resourceId));
  const order = new Map(locs.map((l, i) => [l.id, i]));
  return rows
    .map((r) => ({
      resourceId: r.id,
      name: r.name,
      locationName: locs.find((l) => l.id === r.locationId)?.name ?? "",
      state: blockedIds.has(r.id) ? ("blocked" as const) : occupiedIds.has(r.id) ? ("occupied" as const) : ("free" as const),
      sort: order.get(r.locationId) ?? 0,
    }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ sort: _s, ...r }) => r);
}

/* ---------- live counters ---------- */

export interface Pulse {
  pendingCount: number;
  unread: number;
  /** The soonest deadline of a live request, if any. */
  nextExpiryAt: Date | null;
}

/** What the dashboard polls: cheap counters scoped like everything else. */
export async function getPulse(db: DbOrTx, ctx: TenantContext, now = new Date()): Promise<Pulse> {
  requirePermission(ctx, "dashboard.view");
  const [[row], unread] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int`, next: sql<Date | null>`min(${bookings.pendingExpiresAt})`.mapWith(bookings.pendingExpiresAt) })
      .from(bookings)
      .where(
        and(
          eq(bookings.businessId, ctx.business.id),
          locationScope(ctx),
          eq(bookings.status, "pending"),
          gt(bookings.pendingExpiresAt, now),
        ),
      ),
    countUnread(db, ctx.user.id, ctx.business.id),
  ]);
  return { pendingCount: row?.n ?? 0, unread, nextExpiryAt: row?.next ?? null };
}

/* ---------- bookings ---------- */

/** The business's bookings, always limited to the member's locations whatever the filters say. */
export async function listBookingsForTenant(db: DbOrTx, ctx: TenantContext, filters: BusinessBookingFilters) {
  requirePermission(ctx, "bookings.view");
  return listBusinessBookings(db, ctx.business.id, { ...filters, locationIds: ctx.locationIds });
}

/** One booking with its history and ledger, or null when it is not one the member may see. */
export async function getBookingForTenant(db: DbOrTx, ctx: TenantContext, bookingId: string) {
  requirePermission(ctx, "bookings.view");
  if (!UUID.test(bookingId)) return null;
  const found = await getBusinessBooking(db, ctx.business.id, bookingId);
  if (!found || !ctx.canAccessLocation(found.booking.locationId)) return null;
  return found;
}

export type TenantBooking = NonNullable<Awaited<ReturnType<typeof getBookingForTenant>>>;

export type DecisionAction = "approve" | "reject" | "cancel_by_business" | "complete" | "no_show";

const PERMISSION_FOR: Record<DecisionAction, Permission> = {
  approve: "bookings.decide",
  reject: "bookings.decide",
  cancel_by_business: "bookings.cancel",
  complete: "bookings.mark_attendance",
  no_show: "bookings.mark_attendance",
};

/** Throws not-found for a booking outside the business or the member's locations. */
async function assertVisible(db: DbOrTx, ctx: TenantContext, bookingId: string) {
  if (!UUID.test(bookingId)) throw notFound();
  const [row] = await db
    .select({ locationId: bookings.locationId })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.businessId, ctx.business.id)));
  if (!row || !ctx.canAccessLocation(row.locationId)) throw notFound();
}

/**
 * A business decision on a booking: approve, decline, cancel, or record that
 * the customer came or did not. The engine re-checks the state under a row
 * lock, refuses late decisions on overdue requests and read-only accounts.
 */
export async function decideBooking(
  db: Db,
  ctx: TenantContext,
  input: { bookingId: string; action: DecisionAction; reason?: string },
): Promise<TransitionResult> {
  if (!Object.hasOwn(PERMISSION_FOR, input.action)) throw new AppError("validation", "That is not something you can do to a booking.", 422);
  requirePermission(ctx, PERMISSION_FOR[input.action]);
  await assertVisible(db, ctx, input.bookingId);
  return transitionBooking(db, {
    bookingId: input.bookingId,
    action: input.action,
    actor: { kind: "business", userId: ctx.user.id },
    businessId: ctx.business.id,
    reason: input.reason,
  });
}

/** Appends an internal note. Notes are never shown to customers. */
export async function addNoteForTenant(db: Db, ctx: TenantContext, bookingId: string, note: string) {
  requirePermission(ctx, "bookings.add_note");
  await assertVisible(db, ctx, bookingId);
  if (!(await getTenantAccess(db, ctx.business.id)).writable) {
    throw new EngineError("read_only", "This account is read-only. Renew the subscription to manage bookings.");
  }
  return addInternalNote(db, {
    bookingId,
    businessId: ctx.business.id,
    note,
    actor: { kind: "business", userId: ctx.user.id },
    authorName: ctx.user.name ?? undefined,
  });
}

/**
 * The decisions this member may make on a booking now, in display order.
 * An overdue request offers none: it reads as expired. Attendance can only be
 * recorded once the booking has started.
 */
export function bookingActions(
  ctx: TenantContext,
  b: { status: BookingStatus; pendingExpiresAt: Date | null; startsAt: Date },
  now = new Date(),
): DecisionAction[] {
  const status = effectiveStatus(b, now);
  const out: DecisionAction[] = [];
  if (status === "pending" && ctx.can("bookings.decide")) out.push("approve", "reject");
  if (status === "approved") {
    if (b.startsAt.getTime() <= now.getTime() && ctx.can("bookings.mark_attendance")) out.push("complete", "no_show");
    if (ctx.can("bookings.cancel")) out.push("cancel_by_business");
  }
  return out;
}
