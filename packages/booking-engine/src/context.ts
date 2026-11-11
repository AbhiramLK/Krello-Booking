import { and, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import {
  bookingAllocations,
  businesses,
  locationHours,
  locations,
  pricingRules,
  resourceBlocks,
  resourceSchedules,
  resources,
  scheduleExceptions,
  subscriptions,
  type DbOrTx,
} from "@krello/database";
import type { PricingRule } from "@krello/pricing";
import { EngineError } from "./errors";
import { generateSlots, type DayException, type Slot } from "./slots";
import { dayOfWeek, isValidDate, localToInstant } from "./time";

export type ResourceRow = typeof resources.$inferSelect;
export type LocationRow = typeof locations.$inferSelect;
export type BusinessRow = typeof businesses.$inferSelect;

export interface ActiveAllocation {
  resourceId: string;
  bookingId: string;
  startsAt: Date;
  endsAt: Date;
  status: "held" | "confirmed";
  units: number;
}

export interface ActiveBlock {
  id: string;
  resourceId: string;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
}

export interface DayContext {
  business: BusinessRow;
  location: LocationRow;
  date: string;
  dayOfWeek: number;
  resources: ResourceRow[];
  /** Generated slots per resource id. */
  slots: Map<string, Slot[]>;
  /** Slot length used for per-slot pricing, per resource id. */
  slotDuration: Map<string, number>;
  rules: PricingRule[];
  allocations: ActiveAllocation[];
  blocks: ActiveBlock[];
}

export interface TenantAccess {
  /** Customers can see and request bookings. */
  publicBookable: boolean;
  /** The dashboard may change data. False means read-only. */
  writable: boolean;
  subscriptionStatus: "trialing" | "active" | "grace" | "expired" | "none";
}

const USABLE = new Set(["trialing", "active", "grace"]);

export async function getTenantAccess(tx: DbOrTx, businessId: string): Promise<TenantAccess> {
  const [row] = await tx
    .select({
      status: businesses.status,
      verification: businesses.verificationStatus,
      isListed: businesses.isListed,
      sub: subscriptions.status,
    })
    .from(businesses)
    .leftJoin(subscriptions, eq(subscriptions.businessId, businesses.id))
    .where(eq(businesses.id, businessId));
  if (!row) throw new EngineError("not_found", "Business not found.");
  const subscriptionStatus = row.sub ?? "none";
  const usable = USABLE.has(subscriptionStatus);
  const live = row.status === "active" && row.verification === "approved";
  return {
    publicBookable: live && row.isListed && usable,
    writable: live && usable,
    subscriptionStatus,
  };
}

/**
 * Loads everything needed to answer "what can be booked at this location on
 * this date": schedules, generated slots, prices, blocks and live allocations.
 * Used by the availability view and re-used inside the booking transaction.
 */
export async function loadDayContext(
  tx: DbOrTx,
  args: { locationId: string; date: string; resourceIds?: string[]; includeInactive?: boolean },
): Promise<DayContext> {
  if (!isValidDate(args.date)) throw new EngineError("validation", "Invalid date.");

  const [loc] = await tx.select().from(locations).where(eq(locations.id, args.locationId));
  if (!loc) throw new EngineError("not_found", "Location not found.");
  const [business] = await tx.select().from(businesses).where(eq(businesses.id, loc.businessId));
  if (!business) throw new EngineError("not_found", "Business not found.");

  const resourceRows = await tx
    .select()
    .from(resources)
    .where(
      and(
        eq(resources.locationId, loc.id),
        args.includeInactive ? undefined : eq(resources.status, "active"),
        args.resourceIds ? inArray(resources.id, args.resourceIds.length ? args.resourceIds : ["00000000-0000-0000-0000-000000000000"]) : undefined,
      ),
    )
    .orderBy(resources.sortOrder, resources.name);

  const dow = dayOfWeek(args.date);
  const ids = resourceRows.map((r) => r.id);
  const slots = new Map<string, Slot[]>();
  const slotDuration = new Map<string, number>();

  if (!ids.length) {
    return { business, location: loc, date: args.date, dayOfWeek: dow, resources: [], slots, slotDuration, rules: [], allocations: [], blocks: [] };
  }

  const [scheduleRows, hoursRows, exceptionRows, ruleRows] = await Promise.all([
    tx
      .select()
      .from(resourceSchedules)
      .where(and(inArray(resourceSchedules.resourceId, ids), eq(resourceSchedules.status, "active")))
      .orderBy(resourceSchedules.opensMinute),
    tx.select().from(locationHours).where(eq(locationHours.locationId, loc.id)),
    tx
      .select()
      .from(scheduleExceptions)
      .where(and(eq(scheduleExceptions.locationId, loc.id), eq(scheduleExceptions.date, args.date))),
    tx
      .select()
      .from(pricingRules)
      .where(
        and(
          eq(pricingRules.locationId, loc.id),
          eq(pricingRules.status, "active"),
          or(isNull(pricingRules.resourceId), inArray(pricingRules.resourceId, ids)),
        ),
      ),
  ]);

  const locationException = exceptionRows.find((e) => e.resourceId === null) ?? null;
  const dayHours = hoursRows.filter((h) => h.dayOfWeek === dow);

  for (const r of resourceRows) {
    const mine = scheduleRows.filter(
      (s) =>
        s.resourceId === r.id &&
        (!s.effectiveFrom || s.effectiveFrom <= args.date) &&
        (!s.effectiveTo || s.effectiveTo >= args.date),
    );
    const today = mine.filter((s) => s.dayOfWeek === dow);
    const resourceException = (exceptionRows.find((e) => e.resourceId === r.id) as DayException | undefined) ?? null;
    // A custom-hours override on a normally closed day borrows the slot size
    // from any other day of the resource's schedule.
    const basis = today.length ? today : resourceException?.exceptionType === "custom_hours" ? mine.slice(0, 1) : [];
    slots.set(
      r.id,
      generateSlots({
        schedules: basis,
        locationHours: dayHours,
        locationHasHours: hoursRows.length > 0,
        resourceException,
        locationException: locationException as DayException | null,
      }),
    );
    slotDuration.set(r.id, (basis[0] ?? mine[0])?.slotDurationMinutes ?? 60);
  }

  // Window wide enough to include slots that run past midnight.
  const from = localToInstant(args.date, 0, loc.timezone);
  const to = localToInstant(args.date, 36 * 60, loc.timezone);

  const [allocRows, blockRows] = await Promise.all([
    tx
      .select({
        resourceId: bookingAllocations.resourceId,
        bookingId: bookingAllocations.bookingId,
        startsAt: bookingAllocations.startsAt,
        endsAt: bookingAllocations.endsAt,
        status: bookingAllocations.status,
        units: bookingAllocations.units,
      })
      .from(bookingAllocations)
      .where(
        and(
          inArray(bookingAllocations.resourceId, ids),
          inArray(bookingAllocations.status, ["held", "confirmed"]),
          lt(bookingAllocations.startsAt, to),
          gt(bookingAllocations.endsAt, from),
        ),
      ),
    tx
      .select({
        id: resourceBlocks.id,
        resourceId: resourceBlocks.resourceId,
        startsAt: resourceBlocks.startsAt,
        endsAt: resourceBlocks.endsAt,
        reason: resourceBlocks.reason,
      })
      .from(resourceBlocks)
      .where(
        and(
          inArray(resourceBlocks.resourceId, ids),
          isNull(resourceBlocks.removedAt),
          lt(resourceBlocks.startsAt, to),
          gt(resourceBlocks.endsAt, from),
        ),
      ),
  ]);

  return {
    business,
    location: loc,
    date: args.date,
    dayOfWeek: dow,
    resources: resourceRows,
    slots,
    slotDuration,
    rules: ruleRows.map((r) => ({
      id: r.id,
      resourceId: r.resourceId,
      ruleType: r.ruleType,
      label: r.label,
      daysOfWeek: r.daysOfWeek,
      date: r.date,
      startMinute: r.startMinute,
      endMinute: r.endMinute,
      amount: r.amount,
      priority: r.priority,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
    })),
    allocations: allocRows as ActiveAllocation[],
    blocks: blockRows,
  };
}

export const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
  aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
