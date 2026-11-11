import type { DbOrTx } from "@krello/database";
import { calculatePrice, PricingError } from "@krello/pricing";
import { loadDayContext, overlaps, type DayContext, type ResourceRow } from "./context";
import { addDays, localDateOf, localToInstant } from "./time";

export type SlotState = "available" | "pending_hold" | "confirmed" | "blocked" | "unavailable";

export interface SlotView {
  startsAt: string;
  endsAt: string;
  startMinute: number;
  endMinute: number;
  state: SlotState;
  /** Places left on a shared resource; 1 or 0 for exclusive ones. */
  remaining: number;
  /** Price in paise for one slot (per person where the resource is priced so). */
  price: number | null;
  /** Why a slot is unavailable, for display. */
  note?: string;
}

export interface ResourceAvailability {
  resourceId: string;
  name: string;
  resourceType: string;
  description: string | null;
  bookingMode: "exclusive" | "shared";
  capacity: number;
  priceUnit: "per_hour" | "per_slot";
  pricePerPerson: boolean;
  slots: SlotView[];
}

export interface AvailabilityResult {
  locationId: string;
  date: string;
  timezone: string;
  resources: ResourceAvailability[];
}

/**
 * State of one resource over one interval, given a loaded day. `audience`
 * "business" skips the customer-only advance and notice limits.
 */
export function evaluateInterval(
  ctx: DayContext,
  resource: ResourceRow,
  startsAt: Date,
  endsAt: Date,
  now: Date,
  audience: "customer" | "business",
): { state: SlotState; remaining: number; note?: string } {
  if (audience === "customer") {
    if (startsAt.getTime() < now.getTime() + resource.minNoticeMinutes * 60000) {
      return { state: "unavailable", remaining: 0, note: "Too late to book" };
    }
    const lastDate = addDays(localDateOf(now, ctx.location.timezone), resource.advanceDays);
    if (ctx.date > lastDate) return { state: "unavailable", remaining: 0, note: "Not open for booking yet" };
  } else if (endsAt.getTime() <= now.getTime()) {
    return { state: "unavailable", remaining: 0, note: "In the past" };
  }

  if (ctx.blocks.some((b) => b.resourceId === resource.id && overlaps(b.startsAt, b.endsAt, startsAt, endsAt))) {
    return { state: "blocked", remaining: 0 };
  }

  const hits = ctx.allocations.filter(
    (a) => a.resourceId === resource.id && overlaps(a.startsAt, a.endsAt, startsAt, endsAt),
  );

  if (resource.bookingMode === "exclusive") {
    if (hits.some((a) => a.status === "confirmed")) return { state: "confirmed", remaining: 0 };
    if (hits.length) return { state: "pending_hold", remaining: 0 };
    return { state: "available", remaining: 1 };
  }

  const taken = hits.reduce((n, a) => n + a.units, 0);
  const remaining = Math.max(0, resource.capacity - taken);
  if (remaining === 0) {
    return { state: hits.every((a) => a.status === "held") ? "pending_hold" : "confirmed", remaining: 0 };
  }
  return { state: "available", remaining };
}

export async function getAvailability(
  tx: DbOrTx,
  args: {
    locationId: string;
    date: string;
    resourceIds?: string[];
    audience?: "customer" | "business";
    now?: Date;
  },
): Promise<AvailabilityResult> {
  const now = args.now ?? new Date();
  const audience = args.audience ?? "customer";
  const ctx = await loadDayContext(tx, args);
  const tz = ctx.location.timezone;

  const out: ResourceAvailability[] = ctx.resources.map((r) => {
    const slotDuration = ctx.slotDuration.get(r.id) ?? 60;
    const slots: SlotView[] = (ctx.slots.get(r.id) ?? []).map((s) => {
      const startsAt = localToInstant(ctx.date, s.startMinute, tz);
      const endsAt = localToInstant(ctx.date, s.endMinute, tz);
      let price: number | null = null;
      try {
        price = calculatePrice(
          {
            resourceId: r.id,
            priceUnit: r.priceUnit,
            pricePerPerson: r.pricePerPerson,
            slotDurationMinutes: slotDuration,
            date: ctx.date,
            dayOfWeek: ctx.dayOfWeek,
            startMinute: s.startMinute,
            endMinute: s.endMinute,
            groupSize: 1,
          },
          ctx.rules,
        ).total;
      } catch (e) {
        if (!(e instanceof PricingError)) throw e;
      }
      const ev =
        price === null
          ? { state: "unavailable" as const, remaining: 0, note: "No price set" }
          : evaluateInterval(ctx, r, startsAt, endsAt, now, audience);
      return {
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        startMinute: s.startMinute,
        endMinute: s.endMinute,
        price,
        ...ev,
      };
    });
    return {
      resourceId: r.id,
      name: r.name,
      resourceType: r.resourceType,
      description: r.description,
      bookingMode: r.bookingMode,
      capacity: r.capacity,
      priceUnit: r.priceUnit,
      pricePerPerson: r.pricePerPerson,
      slots,
    };
  });

  return { locationId: ctx.location.id, date: ctx.date, timezone: tz, resources: out };
}
