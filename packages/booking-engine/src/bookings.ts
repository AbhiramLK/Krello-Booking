import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import {
  bookingAllocations,
  bookingStatusHistory,
  bookings,
  businesses,
  enqueueEvent,
  locations,
  pgErrorCode,
  resources,
  writeAudit,
  type Actor,
  type Db,
  type DbOrTx,
  type Tx,
} from "@krello/database";
import { calculatePrice, PricingError, type PriceResult } from "@krello/pricing";
import { STATUS_LABEL, type BookingStatus as LabelStatus } from "./labels";
import { evaluateInterval } from "./availability";
import { getTenantAccess, loadDayContext, type DayContext, type LocationRow } from "./context";
import { EngineError } from "./errors";
import { resolvePolicy } from "./policy";
import { chainSlots } from "./slots";
import { addDays, localDateOf, minuteOfDate } from "./time";

export type BookingRow = typeof bookings.$inferSelect;
export type BookingStatus = BookingRow["status"];

// Labels live in ./labels so browser code can import them; this stops them drifting from the database enum.
export { STATUS_LABEL };
const statusesMatch: [BookingStatus] extends [LabelStatus] ? ([LabelStatus] extends [BookingStatus] ? true : false) : false = true;
void statusesMatch;
export type BookingSource = BookingRow["source"];

/** Most pending requests one phone number may hold across the platform. */
export const MAX_PENDING_PER_PHONE = 3;

export interface AllocationSnapshot {
  resourceId: string;
  resourceName: string;
  startsAt: string;
  endsAt: string;
  units: number;
  price: PriceResult;
}

export interface BookingPriceSnapshot {
  currency: "INR";
  date: string;
  groupSize: number;
  allocations: AllocationSnapshot[];
  total: number;
}

export interface CreateBookingInput {
  locationId: string;
  resourceIds: string[];
  startsAt: Date;
  endsAt: Date;
  customer: {
    name: string;
    phone?: string | null;
    email?: string | null;
    notes?: string | null;
    userId?: string | null;
  };
  groupSize: number;
  source: BookingSource;
  actor: Actor;
  idempotencyKey?: string | null;
  internalNotes?: string | null;
  now?: Date;
}

export interface CreateBookingResult {
  booking: BookingRow;
  /** Secret for the guest status link. Shown once; only its hash is stored. */
  statusToken: string;
  replayed: boolean;
}

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newReference(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return `KR-${s}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newStatusToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

/** Finds which schedule date the interval belongs to and validates the slots. */
async function resolveDay(
  tx: DbOrTx,
  locationId: string,
  timezone: string,
  resourceIds: string[],
  startsAt: Date,
  endsAt: Date,
): Promise<{ ctx: DayContext; startMinute: number; endMinute: number }> {
  const sameDay = localDateOf(startsAt, timezone);
  // A slot after midnight may belong to the previous day's late schedule.
  for (const date of [sameDay, addDays(sameDay, -1)]) {
    const ctx = await loadDayContext(tx, { locationId, date, resourceIds });
    if (ctx.resources.length !== resourceIds.length) {
      throw new EngineError("validation", "One of the selected items is not available at this venue.");
    }
    const startMinute = minuteOfDate(startsAt, date, timezone);
    const endMinute = minuteOfDate(endsAt, date, timezone);
    const ok = ctx.resources.every((r) => chainSlots(ctx.slots.get(r.id) ?? [], startMinute, endMinute));
    if (ok) return { ctx, startMinute, endMinute };
  }
  throw new EngineError("validation", "That time is not a bookable slot.");
}

interface SelectionInput {
  resourceIds: string[];
  startsAt: Date;
  endsAt: Date;
  groupSize: number;
}

/**
 * Checks the shape of a request before anything is read. Returns the resource
 * ids, de-duplicated and sorted. Pass `customerName` to require a name too.
 */
function validateSelection(input: SelectionInput, customerName?: string): string[] {
  const resourceIds = [...new Set(input.resourceIds)].sort();
  if (!resourceIds.length) throw new EngineError("validation", "Choose at least one item to book.");
  if (resourceIds.length > 20) throw new EngineError("validation", "Too many items in one booking.");
  if (customerName !== undefined && !customerName) throw new EngineError("validation", "A customer name is required.");
  if (!Number.isInteger(input.groupSize) || input.groupSize < 1 || input.groupSize > 500) {
    throw new EngineError("validation", "Group size must be a whole number of at least 1.");
  }
  if (!(input.endsAt.getTime() > input.startsAt.getTime())) {
    throw new EngineError("validation", "The booking must end after it starts.");
  }
  return resourceIds;
}

/**
 * Checks every resource is free for the whole interval and prices it. The one
 * code path for both a quote and a real booking, so they cannot disagree.
 * `snapshot.allocations[i]` belongs to `ctx.resources[i]`.
 */
async function priceSelection(
  tx: DbOrTx,
  loc: LocationRow,
  resourceIds: string[],
  input: SelectionInput,
  now: Date,
  audience: "customer" | "business",
): Promise<{ ctx: DayContext; snapshot: BookingPriceSnapshot }> {
  const { ctx, startMinute, endMinute } = await resolveDay(tx, loc.id, loc.timezone, resourceIds, input.startsAt, input.endsAt);

  const exclusiveCapacity = ctx.resources
    .filter((r) => r.bookingMode === "exclusive")
    .reduce((n, r) => n + r.capacity, 0);
  const allExclusive = ctx.resources.every((r) => r.bookingMode === "exclusive");
  if (allExclusive && ctx.resources.some((r) => r.capacity > 1) && input.groupSize > exclusiveCapacity) {
    throw new EngineError("validation", `That selection fits up to ${exclusiveCapacity} people.`);
  }

  const snapshots: AllocationSnapshot[] = [];
  for (const r of ctx.resources) {
    const units = r.bookingMode === "shared" ? input.groupSize : 1;
    const ev = evaluateInterval(ctx, r, input.startsAt, input.endsAt, now, audience);
    if (ev.state !== "available" || ev.remaining < units) {
      const why =
        ev.state === "unavailable"
          ? (ev.note ?? "it cannot be booked")
          : ev.state === "blocked"
            ? "it is blocked for that time"
            : ev.state === "available"
              ? `only ${ev.remaining} place${ev.remaining === 1 ? " is" : "s are"} left`
              : "someone else has just taken it";
      throw new EngineError(
        ev.state === "unavailable" ? "validation" : "slot_conflict",
        `${r.name} is not available: ${why}.`,
        { resourceId: r.id, state: ev.state, remaining: ev.remaining },
      );
    }
    let price: PriceResult;
    try {
      price = calculatePrice(
        {
          resourceId: r.id,
          priceUnit: r.priceUnit,
          pricePerPerson: r.pricePerPerson,
          slotDurationMinutes: ctx.slotDuration.get(r.id) ?? 60,
          date: ctx.date,
          dayOfWeek: ctx.dayOfWeek,
          startMinute,
          endMinute,
          groupSize: input.groupSize,
        },
        ctx.rules,
      );
    } catch (e) {
      if (e instanceof PricingError) throw new EngineError("validation", `${r.name}: ${e.message}`);
      throw e;
    }
    snapshots.push({
      resourceId: r.id,
      resourceName: r.name,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
      units,
      price,
    });
  }

  return {
    ctx,
    snapshot: {
      currency: "INR",
      date: ctx.date,
      groupSize: input.groupSize,
      allocations: snapshots,
      total: snapshots.reduce((n, s) => n + s.price.total, 0),
    },
  };
}

export interface QuoteBookingInput extends SelectionInput {
  locationId: string;
  now?: Date;
  /**
   * Who is asking. "customer" (the default) prices an online request and needs
   * the venue to be taking online bookings. "business" prices a booking the
   * venue's own team enters, by the rules `createBooking` applies to them:
   * no online-only limits. The caller has already checked the team member's access.
   */
  audience?: "customer" | "business";
}

/**
 * Prices a booking without making it, by the same checks and rules
 * `createBooking` applies. Throws the same `EngineError` it would, for
 * example `slot_conflict` when a slot has just been taken.
 */
export async function quoteBooking(db: DbOrTx, input: QuoteBookingInput): Promise<BookingPriceSnapshot> {
  const now = input.now ?? new Date();
  const audience = input.audience ?? "customer";
  const resourceIds = validateSelection(input);
  const [loc] = await db.select().from(locations).where(eq(locations.id, input.locationId));
  if (!loc || loc.status !== "active") throw new EngineError("not_found", "Location not found.");
  if (audience === "customer" && !(await getTenantAccess(db, loc.businessId)).publicBookable) {
    throw new EngineError("not_bookable", "This venue is not taking online bookings right now.");
  }
  const { snapshot } = await priceSelection(db, loc, resourceIds, input, now, audience);
  return snapshot;
}

/**
 * Creates a booking and all of its allocations in one transaction.
 *
 * Online requests start `pending` with their slots held until
 * `pending_expires_at`. Phone, walk-in and admin bookings are entered by the
 * business and start `approved`. Every source goes through the same checks.
 *
 * Concurrency: the resource rows are locked in id order, availability is
 * re-read under that lock, and the exclusion constraint on allocations is the
 * final guard. All resources are allocated or none are.
 */
export async function createBooking(db: Db, input: CreateBookingInput): Promise<CreateBookingResult> {
  const now = input.now ?? new Date();
  const name = input.customer.name?.trim() ?? "";
  const phone = input.customer.phone?.trim() || null;
  const resourceIds = validateSelection(input, name);
  const online = input.source === "online";
  if (online && !phone) throw new EngineError("validation", "A verified phone number is required.");

  try {
    return await db.transaction(async (tx) => {
      const [loc] = await tx.select().from(locations).where(eq(locations.id, input.locationId));
      if (!loc || loc.status !== "active") throw new EngineError("not_found", "Location not found.");
      const businessId = loc.businessId;

      if (input.idempotencyKey) {
        const [existing] = await tx
          .select()
          .from(bookings)
          .where(and(eq(bookings.businessId, businessId), eq(bookings.idempotencyKey, input.idempotencyKey)));
        if (existing) return replay(tx, existing);
      }

      const access = await getTenantAccess(tx, businessId);
      if (online && !access.publicBookable) {
        throw new EngineError("not_bookable", "This venue is not taking online bookings right now.");
      }
      if (!online && !access.writable) {
        throw new EngineError("read_only", "This account is read-only. Renew the subscription to add bookings.");
      }

      if (online) {
        const [row] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(bookings)
          .where(and(eq(bookings.customerPhone, phone!), eq(bookings.status, "pending")));
        if ((row?.n ?? 0) >= MAX_PENDING_PER_PHONE) {
          throw new EngineError(
            "limit",
            `You already have ${MAX_PENDING_PER_PHONE} requests waiting for a response. Wait for a venue to respond or cancel one first.`,
          );
        }
      }

      // Serialise everything that touches these resources. Sorted ids, so two
      // multi-resource requests cannot deadlock each other.
      const locked = await tx
        .select({ id: resources.id })
        .from(resources)
        .where(and(inArray(resources.id, resourceIds), eq(resources.locationId, loc.id)))
        .orderBy(resources.id)
        .for("update");
      if (locked.length !== resourceIds.length) {
        throw new EngineError("validation", "One of the selected items is not available at this venue.");
      }

      if (input.idempotencyKey) {
        // Checked again under the lock: a duplicate submission that raced the
        // original waits here, and must get that booking back, not a conflict.
        const [existing] = await tx
          .select()
          .from(bookings)
          .where(and(eq(bookings.businessId, businessId), eq(bookings.idempotencyKey, input.idempotencyKey)));
        if (existing) return replay(tx, existing);
      }

      const { ctx, snapshot } = await priceSelection(tx, loc, resourceIds, input, now, online ? "customer" : "business");
      const snapshots = snapshot.allocations;
      const total = snapshot.total;
      const policy = resolvePolicy(ctx.business.policy);
      const status: BookingStatus = online ? "pending" : "approved";
      // A hold never outlives the start of the slot it is holding.
      const pendingExpiresAt = online
        ? new Date(Math.min(now.getTime() + policy.pendingHoldMinutes * 60000, input.startsAt.getTime()))
        : null;
      const { token, hash } = newStatusToken();

      const [booking] = await tx
        .insert(bookings)
        .values({
          publicReference: newReference(),
          statusTokenHash: hash,
          businessId,
          locationId: loc.id,
          customerUserId: input.customer.userId ?? null,
          customerName: name,
          customerPhone: phone,
          customerEmail: input.customer.email?.trim() || null,
          customerNotes: input.customer.notes?.trim() || null,
          groupSize: input.groupSize,
          source: input.source,
          status,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          requestedAt: now,
          pendingExpiresAt,
          approvedAt: online ? null : now,
          createdBy: input.actor.userId ?? null,
          internalNotes: input.internalNotes?.trim() || null,
          priceSnapshot: snapshot,
          totalAmount: total,
          idempotencyKey: input.idempotencyKey ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!booking) throw new Error("Booking insert returned no row");

      await tx.insert(bookingAllocations).values(
        ctx.resources.map((r, i) => ({
          bookingId: booking.id,
          businessId,
          locationId: loc.id,
          resourceId: r.id,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          isExclusive: r.bookingMode === "exclusive",
          units: snapshots[i]!.units,
          status: online ? ("held" as const) : ("confirmed" as const),
          priceSnapshot: snapshots[i]!.price,
          createdAt: now,
        })),
      );

      await tx.insert(bookingStatusHistory).values({
        bookingId: booking.id,
        businessId,
        fromStatus: null,
        toStatus: status,
        actorUserId: input.actor.userId ?? null,
        actorKind: input.actor.kind,
        createdAt: now,
      });
      await writeAudit(tx, {
        actor: input.actor,
        businessId,
        targetType: "booking",
        targetId: booking.id,
        action: "booking.created",
        after: { status, source: input.source, total, resourceIds },
      });
      await enqueueEvent(tx, online ? "booking.requested" : "booking.created_by_business", { bookingId: booking.id }, businessId);

      return { booking, statusToken: token, replayed: false };
    });
  } catch (e) {
    const code = pgErrorCode(e);
    if (code === "23P01") {
      // Exclusion constraint: another request claimed an overlapping slot.
      throw new EngineError("slot_conflict", "Someone else has just taken that slot. Please choose another.");
    }
    if (code === "23505" && input.idempotencyKey) {
      // A concurrent duplicate submission won the race; return its booking.
      return db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(bookings)
          .where(eq(bookings.idempotencyKey, input.idempotencyKey!));
        if (!existing) throw e;
        return replay(tx, existing);
      });
    }
    throw e;
  }
}

/** A repeated submission gets the original booking and a fresh status token. */
async function replay(tx: Tx, existing: BookingRow): Promise<CreateBookingResult> {
  const { token, hash } = newStatusToken();
  const [booking] = await tx
    .update(bookings)
    .set({ statusTokenHash: hash })
    .where(eq(bookings.id, existing.id))
    .returning();
  return { booking: booking!, statusToken: token, replayed: true };
}

/* ------------------------------------------------------------------ */
/* State changes                                                       */
/* ------------------------------------------------------------------ */

export type BookingAction =
  | "approve"
  | "reject"
  | "cancel_by_customer"
  | "cancel_by_business"
  | "complete"
  | "no_show"
  | "expire";

const TARGET: Record<BookingAction, BookingStatus> = {
  approve: "approved",
  reject: "rejected",
  cancel_by_customer: "cancelled_by_customer",
  cancel_by_business: "cancelled_by_business",
  complete: "completed",
  no_show: "no_show",
  expire: "expired",
};

/** Allowed moves (spec 8.3). Anything not listed is refused. */
const ALLOWED_FROM: Record<BookingAction, BookingStatus[]> = {
  approve: ["pending"],
  reject: ["pending"],
  expire: ["pending"],
  cancel_by_customer: ["pending", "approved"],
  cancel_by_business: ["approved"],
  complete: ["approved"],
  no_show: ["approved"],
};

const RELEASES: BookingAction[] = ["reject", "expire", "cancel_by_customer", "cancel_by_business"];

export interface TransitionInput {
  bookingId: string;
  action: BookingAction;
  actor: Actor;
  /** When set, the booking must belong to this business. */
  businessId?: string;
  reason?: string | null;
  now?: Date;
}

export interface TransitionResult {
  booking: BookingRow;
  /** False when the booking was already in the target state. */
  changed: boolean;
}

async function applyTransition(
  tx: Tx,
  current: BookingRow,
  action: BookingAction,
  actor: Actor,
  reason: string | null,
  now: Date,
): Promise<BookingRow> {
  const to = TARGET[action];
  const patch: Partial<typeof bookings.$inferInsert> = { status: to, updatedAt: now };
  if (action === "approve") patch.approvedAt = now;
  if (action === "reject") {
    patch.rejectedAt = now;
    patch.rejectionReason = reason;
  }
  if (action === "cancel_by_customer" || action === "cancel_by_business") {
    patch.cancelledAt = now;
    patch.cancellationReason = reason;
  }
  if (action === "complete") patch.completedAt = now;

  const [booking] = await tx.update(bookings).set(patch).where(eq(bookings.id, current.id)).returning();

  if (action === "approve") {
    await tx
      .update(bookingAllocations)
      .set({ status: "confirmed" })
      .where(and(eq(bookingAllocations.bookingId, current.id), eq(bookingAllocations.status, "held")));
  } else if (RELEASES.includes(action)) {
    // Only rows that are still active are touched, so a release happens once.
    await tx
      .update(bookingAllocations)
      .set({ status: "released", releasedAt: now })
      .where(
        and(eq(bookingAllocations.bookingId, current.id), inArray(bookingAllocations.status, ["held", "confirmed"])),
      );
  }

  await tx.insert(bookingStatusHistory).values({
    bookingId: current.id,
    businessId: current.businessId,
    fromStatus: current.status,
    toStatus: to,
    actorUserId: actor.userId ?? null,
    actorKind: actor.kind,
    reason,
    createdAt: now,
  });
  await writeAudit(tx, {
    actor,
    businessId: current.businessId,
    targetType: "booking",
    targetId: current.id,
    action: `booking.${to}`,
    before: { status: current.status },
    after: { status: to },
    reason,
  });
  await enqueueEvent(tx, `booking.${to}`, { bookingId: current.id }, current.businessId);
  return booking!;
}

/**
 * Moves a booking to a new state. The row is locked first, so two competing
 * actions (say, an approval and the expiry job) are decided one after the other.
 */
export async function transitionBooking(db: Db, input: TransitionInput): Promise<TransitionResult> {
  const now = input.now ?? new Date();
  const reason = input.reason?.trim() || null;
  const { action } = input;

  const outcome = await db.transaction(async (tx): Promise<TransitionResult | { lateDecision: true }> => {
    const [current] = await tx.select().from(bookings).where(eq(bookings.id, input.bookingId)).for("update");
    if (!current || (input.businessId && current.businessId !== input.businessId)) {
      throw new EngineError("not_found", "Booking not found.");
    }
    const to = TARGET[action];
    if (current.status === to) return { booking: current, changed: false };

    if (!ALLOWED_FROM[action].includes(current.status)) {
      if (action === "expire") return { booking: current, changed: false };
      throw new EngineError(
        "invalid_transition",
        `This booking is ${STATUS_LABEL[current.status].toLowerCase()} and cannot be changed that way.`,
        { status: current.status },
      );
    }

    const overdue =
      current.status === "pending" && current.pendingExpiresAt !== null && current.pendingExpiresAt.getTime() <= now.getTime();

    if (action === "expire") {
      if (!overdue) return { booking: current, changed: false };
      return { booking: await applyTransition(tx, current, "expire", input.actor, null, now), changed: true };
    }

    if (input.actor.kind === "business") {
      const access = await getTenantAccess(tx, current.businessId);
      if (!access.writable) {
        throw new EngineError("read_only", "This account is read-only. Renew the subscription to manage bookings.");
      }
    }

    if ((action === "approve" || action === "reject") && overdue) {
      // The deadline passed before the decision arrived. Record the expiry now
      // rather than waiting for the worker, then report it.
      await applyTransition(tx, current, "expire", { kind: "system" }, null, now);
      return { lateDecision: true };
    }

    if (action === "reject" && !reason) throw new EngineError("validation", "Give a reason for declining.");
    if (action === "cancel_by_business" && !reason) throw new EngineError("validation", "Give a reason for cancelling.");

    if (action === "cancel_by_customer") {
      const [biz] = await tx
        .select({ policy: businesses.policy })
        .from(businesses)
        .where(eq(businesses.id, current.businessId));
      const policy = resolvePolicy(biz?.policy);
      if (policy.cancellationReasonRequired && !reason) {
        throw new EngineError("validation", "Please say why you are cancelling.");
      }
      if (current.status === "pending" && !policy.customerCanCancelPending) {
        throw new EngineError("policy", "This venue does not allow requests to be cancelled online. Please call them.");
      }
      if (current.status === "approved") {
        if (!policy.customerCanCancelApproved) {
          throw new EngineError("policy", "This venue does not allow confirmed bookings to be cancelled online. Please call them.");
        }
        const deadline = current.startsAt.getTime() - policy.cancellationDeadlineMinutes * 60000;
        if (now.getTime() > deadline) {
          throw new EngineError("policy", "The cancellation deadline for this booking has passed. Please call the venue.");
        }
      }
    }

    if ((action === "complete" || action === "no_show") && current.startsAt.getTime() > now.getTime()) {
      throw new EngineError("validation", "This booking has not started yet.");
    }

    return { booking: await applyTransition(tx, current, action, input.actor, reason, now), changed: true };
  });

  if ("lateDecision" in outcome) {
    throw new EngineError("invalid_transition", "This request expired before a decision was made. The slot has been released.", {
      status: "expired",
    });
  }
  return outcome;
}

/**
 * Expires every pending request whose deadline has passed. Safe to run as
 * often as you like and from several workers at once: each booking is
 * re-checked under a row lock, so nothing is released twice.
 */
export async function expireOverdueBookings(
  db: Db,
  opts: { now?: Date; limit?: number; businessId?: string } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const due = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.status, "pending"),
        lte(bookings.pendingExpiresAt, now),
        opts.businessId ? eq(bookings.businessId, opts.businessId) : undefined,
      ),
    )
    .limit(opts.limit ?? 500);
  let expired = 0;
  for (const { id } of due) {
    const r = await transitionBooking(db, { bookingId: id, action: "expire", actor: { kind: "system" }, now });
    if (r.changed) expired++;
  }
  return expired;
}

/** Appends a timestamped internal note. Never shown to customers. */
export async function addInternalNote(
  db: Db,
  input: { bookingId: string; businessId: string; note: string; actor: Actor; authorName?: string; now?: Date },
): Promise<BookingRow> {
  const note = input.note.trim();
  if (!note) throw new EngineError("validation", "The note is empty.");
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(bookings).where(eq(bookings.id, input.bookingId)).for("update");
    if (!current || current.businessId !== input.businessId) throw new EngineError("not_found", "Booking not found.");
    const line = `[${now.toISOString()}${input.authorName ? ` ${input.authorName}` : ""}] ${note}`;
    const [booking] = await tx
      .update(bookings)
      .set({ internalNotes: current.internalNotes ? `${current.internalNotes}\n${line}` : line, updatedAt: now })
      .where(eq(bookings.id, current.id))
      .returning();
    await writeAudit(tx, {
      actor: input.actor,
      businessId: current.businessId,
      targetType: "booking",
      targetId: current.id,
      action: "booking.note_added",
    });
    return booking!;
  });
}
