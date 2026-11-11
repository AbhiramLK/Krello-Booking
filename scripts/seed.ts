/**
 * Demo seed: three fictional venues in Bengaluru and about seven weeks of
 * booking history, so every screen has something to show.
 *
 * Bookings are not inserted by hand. Each one goes through the booking engine
 * with `now` set to the moment it would really have happened, then moves
 * through its life (approved, completed, cancelled ...) the same way. That keeps
 * the data honest: the same rules apply as in the live product.
 *
 *   pnpm db:seed          run against DATABASE_URL (see .env)
 */
import path from "node:path";
import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import {
  activityCategories,
  businessCategories,
  businessMemberships,
  businesses,
  createDb,
  locationHours,
  locations,
  outboxEvents,
  platformSettings,
  pricingRules,
  resourceSchedules,
  resources,
  reviews,
  schema,
  subscriptionPlans,
  subscriptions,
  users,
  verificationSubmissions,
  type Actor,
  type Db,
} from "@krello/database";
import {
  addDays,
  createBooking,
  dayOfWeek,
  EngineError,
  localDateOf,
  localToInstant,
  recordPayment,
  transitionBooking,
  type BookingAction,
} from "@krello/booking-engine";
import {
  BUSINESS_CANCEL_REASONS,
  BUSINESSES,
  CATEGORIES,
  CUSTOMER_CANCEL_REASONS,
  CUSTOMER_COUNT,
  CUSTOMER_NOTES,
  DEMO_LOGINS,
  EVERY_DAY,
  FIRST_NAMES,
  INTERNAL_NOTES,
  LAST_NAMES,
  PLANS,
  REJECT_REASONS,
  RESPONSES,
  type BusinessSpec,
  type LocationSpec,
  type ResourceGroupSpec,
} from "./seed-data";

export interface SeedSummary {
  businesses: number;
  bookings: number;
  payments: number;
  reviews: number;
  logins: { role: string; phone: string; business?: string }[];
}

const TZ = "Asia/Kolkata";
const MIN = 60_000;
const HISTORY_DAYS = 45;
const FUTURE_DAYS = 7;
/** Fixed, so two runs give the same data. */
const SEED = 20261112;

/* ------------------------------------------------------------------ */
/* Seeded random numbers                                               */
/* ------------------------------------------------------------------ */

interface Rng {
  next(): number;
  /** Whole number in [lo, hi]. */
  int(lo: number, hi: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
  weighted<T>(items: readonly (readonly [T, number])[]): T;
}

/** mulberry32 */
function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (items) => items[Math.floor(next() * items.length)]!,
    chance: (p) => next() < p,
    weighted: (items) => {
      const total = items.reduce((n, [, w]) => n + w, 0);
      let r = next() * total;
      for (const [item, w] of items) {
        r -= w;
        if (r < 0) return item;
      }
      return items[items.length - 1]![0];
    },
  };
}

/* ------------------------------------------------------------------ */
/* Built venue structures                                              */
/* ------------------------------------------------------------------ */

interface Slot {
  start: number;
  end: number;
}

interface BuiltResource {
  id: string;
  name: string;
}

interface BuiltGroup {
  spec: ResourceGroupSpec;
  resources: BuiltResource[];
  slots: Slot[];
}

interface BuiltLocation {
  id: string;
  spec: LocationSpec;
  groups: BuiltGroup[];
  /** Business users who take walk-in and phone bookings at this location. */
  floorActors: string[];
}

interface BuiltBusiness {
  id: string;
  spec: BusinessSpec;
  index: number;
  locations: BuiltLocation[];
  /** Business users who answer online requests. */
  approvers: string[];
}

interface Customer {
  userId: string;
  name: string;
  phone: string;
}

interface LedgerEntry {
  bookingId: string;
  businessIndex: number;
  locationId: string;
  customer: Customer | null;
  completedAt: Date;
}

interface Stats {
  attempts: number;
  skipped: number;
}

function groupSlots(loc: LocationSpec, g: ResourceGroupSpec): Slot[] {
  const out: Slot[] = [];
  for (const [opens, closes] of g.windows) {
    for (let s = opens; s + g.slotMinutes <= closes; s += g.slotMinutes) {
      if (loc.hours.some(([o, c]) => s >= o && s + g.slotMinutes <= c)) out.push({ start: s, end: s + g.slotMinutes });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Reset and static rows                                               */
/* ------------------------------------------------------------------ */

async function truncateEverything(db: Db) {
  const tables = (Object.values(schema) as unknown[])
    .filter((t): t is PgTable => is(t, PgTable))
    .map((t) => `"${getTableName(t)}"`);
  await db.execute(sql.raw(`TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY CASCADE`));
}

function buildCustomerList(): { name: string; phone: string }[] {
  const out = [{ name: DEMO_LOGINS.customer.name, phone: DEMO_LOGINS.customer.phone }];
  for (let i = 1; i <= CUSTOMER_COUNT; i++) {
    const first = FIRST_NAMES[(i - 1) % FIRST_NAMES.length]!;
    const last = LAST_NAMES[((i - 1) * 7 + Math.floor((i - 1) / FIRST_NAMES.length)) % LAST_NAMES.length]!;
    // +91 9000000 1xx ... 9xx
    out.push({ name: `${first} ${last}`, phone: `+919000000${100 + (i - 1) * 12}` });
  }
  return out;
}

async function insertVenue(
  db: Db,
  spec: BusinessSpec,
  index: number,
  ids: { ownerId: string; plans: Map<string, string>; categories: Map<string, string>; adminId: string },
  extra: { managerId?: string; staffId?: string },
  now: Date,
): Promise<BuiltBusiness> {
  const created = new Date(now.getTime() - 90 * 24 * 60 * MIN);
  const [biz] = await db
    .insert(businesses)
    .values({
      ownerUserId: ids.ownerId,
      name: spec.name,
      slug: spec.slug,
      description: spec.description,
      contactPhone: spec.contactPhone,
      amenities: spec.amenities,
      verificationStatus: "approved",
      policy: spec.policy,
      createdAt: created,
      updatedAt: created,
    })
    .returning();
  const businessId = biz!.id;

  await db.insert(businessCategories).values(spec.categories.map((slug) => ({ businessId, categoryId: ids.categories.get(slug)! })));
  await db.insert(verificationSubmissions).values({
    businessId,
    reviewStatus: "verified",
    reviewedBy: ids.adminId,
    reviewedAt: new Date(created.getTime() + 2 * 24 * 60 * MIN),
    createdAt: created,
  });

  const day = 24 * 60 * MIN;
  await db.insert(subscriptions).values(
    spec.subscription === "trialing"
      ? {
          businessId,
          planId: ids.plans.get(spec.plan)!,
          status: "trialing" as const,
          trialStartsAt: new Date(now.getTime() - 9 * day),
          trialEndsAt: new Date(now.getTime() + 5 * day),
        }
      : {
          businessId,
          planId: ids.plans.get(spec.plan)!,
          status: "active" as const,
          currentPeriodStartsAt: new Date(now.getTime() - 12 * day),
          currentPeriodEndsAt: new Date(now.getTime() + 18 * day),
        },
  );

  const built: BuiltBusiness = { id: businessId, spec, index, locations: [], approvers: [ids.ownerId] };
  const memberships: (typeof businessMemberships.$inferInsert)[] = [{ businessId, userId: ids.ownerId, role: "owner", locationIds: [] }];
  if (extra.managerId) {
    built.approvers.push(extra.managerId);
    memberships.push({ businessId, userId: extra.managerId, role: "manager", locationIds: [] });
  }

  for (const [locIndex, locSpec] of spec.locations.entries()) {
    const [loc] = await db
      .insert(locations)
      .values({
        businessId,
        name: locSpec.name,
        slug: locSpec.slug,
        address: locSpec.address,
        locality: locSpec.locality,
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: locSpec.postalCode,
        phone: locSpec.phone,
        timezone: TZ,
      })
      .returning();
    const base = { businessId, locationId: loc!.id };

    await db.insert(locationHours).values(
      EVERY_DAY.flatMap((d) => locSpec.hours.map(([o, c]) => ({ ...base, dayOfWeek: d, opensMinute: o, closesMinute: c }))),
    );

    const groups: BuiltGroup[] = [];
    let sortOrder = 0;
    for (const g of locSpec.groups) {
      const rows = await db
        .insert(resources)
        .values(
          g.names.map((name) => ({
            ...base,
            name,
            resourceType: g.resourceType,
            description: g.description,
            bookingMode: g.bookingMode,
            capacity: g.capacity,
            priceUnit: g.priceUnit,
            pricePerPerson: g.pricePerPerson,
            advanceDays: g.advanceDays,
            minNoticeMinutes: g.minNoticeMinutes,
            sortOrder: sortOrder++,
          })),
        )
        .returning();
      await db.insert(resourceSchedules).values(
        rows.flatMap((r) =>
          EVERY_DAY.flatMap((d) =>
            g.windows.map(([o, c]) => ({
              businessId,
              resourceId: r.id,
              dayOfWeek: d,
              opensMinute: o,
              closesMinute: c,
              slotDurationMinutes: g.slotMinutes,
              slotIntervalMinutes: g.slotMinutes,
            })),
          ),
        ),
      );
      await db.insert(pricingRules).values(
        rows.flatMap((r) =>
          g.rules.map((rule) => ({
            ...base,
            resourceId: r.id,
            ruleType: rule.type,
            label: rule.label ?? null,
            daysOfWeek: rule.daysOfWeek ?? null,
            startMinute: rule.startMinute ?? null,
            endMinute: rule.endMinute ?? null,
            amount: rule.amount,
          })),
        ),
      );
      groups.push({ spec: g, resources: rows.map((r) => ({ id: r.id, name: r.name })), slots: groupSlots(locSpec, g) });
    }

    // Staff are tied to the first location only; everyone else covers all.
    const floorActors =
      locIndex === 0 && extra.staffId
        ? [extra.staffId, extra.staffId, ...(extra.managerId ? [extra.managerId] : []), ids.ownerId]
        : [...(extra.managerId ? [extra.managerId] : []), ids.ownerId];
    if (locIndex === 0 && extra.staffId) {
      memberships.push({ businessId, userId: extra.staffId, role: "staff", locationIds: [loc!.id] });
    }
    built.locations.push({ id: loc!.id, spec: locSpec, groups, floorActors });
  }

  await db.insert(businessMemberships).values(memberships);
  return built;
}

/* ------------------------------------------------------------------ */
/* Booking history                                                     */
/* ------------------------------------------------------------------ */

type Phase = "past" | "live" | "future";
type Outcome =
  | "approved"
  | "completed"
  | "no_show"
  | "cancel_customer"
  | "cancel_business"
  | "rejected"
  | "expired"
  | "cancel_pending"
  | "pending";
type Source = "online" | "walk_in" | "phone";

interface Env {
  db: Db;
  now: Date;
  rng: Rng;
  biz: BuiltBusiness;
  customers: Customer[];
  ledger: LedgerEntry[];
  stats: Stats;
  /** Ids of requests deliberately left pending. */
  livePending: string[];
  /** Online bookings still owed to the demo customer for the near future. */
  demoQuota: number;
}

interface Plan {
  loc: BuiltLocation;
  group: BuiltGroup;
  resourceIds: string[];
  slot: Slot;
  date: string;
  startsAt: Date;
  endsAt: Date;
  groupSize: number;
}

const inAny = (m: number, ranges: [number, number][]) => ranges.some(([a, b]) => m >= a && m < b);

/** Draws a bookable slot (or run of consecutive slots) on `date`. */
function drawPlan(env: Env, loc: BuiltLocation, date: string): Plan {
  const { rng } = env;
  const group = rng.weighted(loc.groups.map((g) => [g, g.spec.demand.weight] as const));
  const d = group.spec.demand;
  const slots = group.slots;

  const contiguous = (i: number, n: number) => {
    if (i + n > slots.length) return false;
    for (let j = 1; j < n; j++) if (slots[i + j]!.start !== slots[i + j - 1]!.end) return false;
    return true;
  };
  let n = rng.weighted([[1, d.lengths[0]], [2, d.lengths[1]], [3, d.lengths[2]]] as const);
  if (!slots.some((_, i) => contiguous(i, n))) n = 1;
  const starts = slots.map((_, i) => i).filter((i) => contiguous(i, n));
  const first = rng.weighted(starts.map((i) => [i, inAny(slots[i]!.start, d.peaks) ? 3 : 1] as const));
  const slot: Slot = { start: slots[first]!.start, end: slots[first + n - 1]!.end };

  let picked: BuiltResource[];
  const pool = group.resources;
  if (d.multiChance && pool.length > 1 && rng.chance(d.multiChance)) {
    const k = rng.int(2, Math.min(3, pool.length));
    const bag = [...pool];
    picked = [];
    while (picked.length < k) picked.push(bag.splice(rng.int(0, bag.length - 1), 1)[0]!);
  } else {
    picked = [rng.pick(pool)];
  }
  const groupSize = picked.length > 1 ? picked.length : rng.int(d.party[0], d.party[1]);

  return {
    loc,
    group,
    resourceIds: picked.map((r) => r.id),
    slot,
    date,
    startsAt: localToInstant(date, slot.start, TZ),
    endsAt: localToInstant(date, slot.end, TZ),
    groupSize,
  };
}

function pickCustomer(env: Env, allowDemo: boolean): Customer {
  const { rng, customers } = env;
  if (allowDemo && rng.chance(0.05)) return customers[0]!;
  const others = customers.length - 1;
  // Squaring the draw makes a few regulars come back more often.
  const idx = 1 + Math.min(others - 1, Math.floor(others * rng.next() ** 1.6));
  return customers[idx]!;
}

function chooseOutcome(env: Env, phase: Phase, source: Source): Outcome {
  const { rng } = env;
  if (phase === "live") return "approved";
  if (phase === "future") {
    if (source === "phone") return rng.weighted([["approved", 92], ["cancel_customer", 8]] as const);
    return rng.weighted([["approved", 84], ["cancel_customer", 6], ["rejected", 5], ["expired", 5]] as const);
  }
  if (source === "walk_in") return rng.weighted([["completed", 96], ["cancel_business", 4]] as const);
  if (source === "phone") {
    return rng.weighted([["completed", 78], ["no_show", 8], ["cancel_customer", 8], ["cancel_business", 6]] as const);
  }
  return rng.weighted([
    ["completed", 62],
    ["no_show", 6],
    ["cancel_customer", 7],
    ["cancel_business", 3],
    ["rejected", 8],
    ["expired", 9],
    ["cancel_pending", 5],
  ] as const);
}

function pickMethod(rng: Rng): "upi" | "cash" | "card" {
  return rng.weighted([["upi", 60], ["cash", 30], ["card", 10]] as const);
}

function pickReference(rng: Rng, method: "upi" | "cash" | "card"): string | null {
  if (method === "upi") return `UPI${String(rng.int(0, 999_999_999)).padStart(9, "0")}${String(rng.int(0, 999)).padStart(3, "0")}`;
  if (method === "card") return `Card ending ${String(rng.int(0, 9999)).padStart(4, "0")}`;
  return null;
}

/** A part payment: a multiple of ₹50, more than zero and less than the total. Null when the total is too small. */
function partAmount(rng: Rng, total: number, lo: number, hi: number): number | null {
  const amount = Math.floor((total * (lo + rng.next() * (hi - lo))) / 5000) * 5000;
  return amount >= 5000 && amount < total ? amount : null;
}

async function transition(
  env: Env,
  bookingId: string,
  action: BookingAction,
  actor: Actor,
  now: Date,
  reason?: string,
) {
  const r = await transitionBooking(env.db, { bookingId, action, actor, now, reason });
  // Every move here is planned, so a no-op means the plan and the engine disagree.
  if (!r.changed) throw new Error(`Seed: ${action} did not change booking ${bookingId}`);
  return r.booking;
}

/** Creates one booking and walks it through its planned life. Returns the id, or null if the slot was skipped. */
async function runBooking(
  env: Env,
  plan: Plan,
  opts: { source: Source; requestedAt: Date; outcome: Outcome; customer: Customer; forceApproved?: boolean },
): Promise<string | null> {
  const { db, rng, now, biz } = env;
  const { source, requestedAt, customer } = opts;
  let outcome = opts.outcome;
  const online = source === "online";
  const floor: Actor = { kind: "business", userId: rng.pick(plan.loc.floorActors) };
  const approver: Actor = { kind: "business", userId: rng.pick(biz.approvers) };
  const asCustomer: Actor = { kind: "customer", userId: online ? customer.userId : null };
  const deadlineMs = biz.spec.policy.cancellationDeadlineMinutes * MIN;

  const withPhone = online || source === "phone" || rng.chance(0.5);
  const notes = online && rng.chance(0.12) ? rng.pick(CUSTOMER_NOTES) : null;
  const internal = !online && rng.chance(0.1) ? rng.pick(INTERNAL_NOTES) : null;

  env.stats.attempts++;
  let booking;
  try {
    ({ booking } = await createBooking(db, {
      locationId: plan.loc.id,
      resourceIds: plan.resourceIds,
      startsAt: plan.startsAt,
      endsAt: plan.endsAt,
      customer: {
        name: customer.name,
        phone: withPhone ? customer.phone : null,
        userId: online ? customer.userId : null,
        notes,
      },
      groupSize: plan.groupSize,
      source,
      actor: online ? asCustomer : floor,
      internalNotes: internal,
      now: requestedAt,
    }));
  } catch (e) {
    // Another booking already holds that slot, or the draw did not land on one.
    if (e instanceof EngineError && (e.code === "slot_conflict" || e.code === "validation")) {
      env.stats.skipped++;
      return null;
    }
    throw e;
  }

  const id = booking.id;
  const total = booking.totalAmount;
  let decidedAt = requestedAt;
  const payAt = (t: Date) => new Date(Math.min(t.getTime(), now.getTime()));
  const collect = async (kind: "collection" | "refund", amount: number, at: Date, actor: Actor, method = pickMethod(rng)) => {
    await recordPayment(db, {
      businessId: biz.id,
      bookingId: id,
      kind,
      amount,
      method,
      reference: kind === "collection" ? pickReference(rng, method) : null,
      notes: kind === "refund" ? "Advance returned" : null,
      collectedAt: payAt(at),
      actor,
    });
  };

  if (online) {
    const expiry = booking.pendingExpiresAt!;
    const hold = expiry.getTime() - requestedAt.getTime();
    const decideAt = new Date(requestedAt.getTime() + rng.int(2 * MIN, hold - MIN));
    if (outcome === "pending") return id;
    if (outcome === "expired") {
      await transition(env, id, "expire", { kind: "system" }, expiry);
      return id;
    }
    if (outcome === "rejected") {
      await transition(env, id, "reject", approver, decideAt, rng.pick(REJECT_REASONS));
      return id;
    }
    if (outcome === "cancel_pending") {
      await transition(env, id, "cancel_by_customer", asCustomer, decideAt, rng.chance(0.5) ? rng.pick(CUSTOMER_CANCEL_REASONS) : undefined);
      return id;
    }
    await transition(env, id, "approve", approver, decideAt);
    decidedAt = decideAt;
  }

  // The booking is approved from here on. Some customers pay an advance.
  const tooLate = (hi: number, lo: number) => hi - lo < 10 * MIN;
  const cancelCustomerLatest = Math.min(plan.startsAt.getTime() - deadlineMs - MIN, now.getTime());
  const cancelBusinessLatest = Math.min(plan.startsAt.getTime() - 15 * MIN, now.getTime());
  const earliest = decidedAt.getTime() + 5 * MIN;
  if (outcome === "cancel_customer" && (source === "walk_in" || tooLate(cancelCustomerLatest, earliest))) {
    outcome = plan.endsAt <= now ? "completed" : "approved";
  }
  if (outcome === "cancel_business" && tooLate(cancelBusinessLatest, earliest)) {
    outcome = plan.endsAt <= now ? "completed" : "approved";
  }

  let advance: number | null = null;
  const advanceMethod = pickMethod(rng);
  const wantsAdvance =
    outcome === "approved" ? rng.chance(0.22)
    : outcome === "no_show" ? rng.chance(0.12)
    : outcome === "cancel_business" ? rng.chance(0.4)
    : outcome === "completed" ? source !== "walk_in" && rng.chance(0.12)
    : false;
  if (wantsAdvance) advance = partAmount(rng, total, 0.3, 0.5);
  if (advance) {
    await collect("collection", advance, new Date(decidedAt.getTime() + rng.int(2, 40) * MIN), floor, advanceMethod);
  }

  const between = (lo: number, hi: number) => new Date(lo + Math.floor(rng.next() * (hi - lo)));

  if (outcome === "cancel_customer") {
    const t = between(earliest, cancelCustomerLatest);
    await transition(env, id, "cancel_by_customer", asCustomer, t, rng.chance(0.6) ? rng.pick(CUSTOMER_CANCEL_REASONS) : undefined);
  } else if (outcome === "cancel_business") {
    const t = between(earliest, cancelBusinessLatest);
    await transition(env, id, "cancel_by_business", approver, t, rng.pick(BUSINESS_CANCEL_REASONS));
    if (advance) await collect("refund", advance, new Date(t.getTime() + 20 * MIN), approver, advanceMethod);
  } else if (outcome === "no_show") {
    const t = new Date(Math.min(plan.startsAt.getTime() + rng.int(10, 30) * MIN, plan.endsAt.getTime()));
    await transition(env, id, "no_show", floor, t);
  } else if (outcome === "completed") {
    const t = new Date(Math.min(plan.endsAt.getTime() + rng.int(0, 25) * MIN, now.getTime()));
    await transition(env, id, "complete", floor, t);
    if (online) env.ledger.push({ bookingId: id, businessIndex: biz.index, locationId: plan.loc.id, customer, completedAt: t });

    // Most completed bookings are settled at the venue.
    const left = total - (advance ?? 0);
    const roll = rng.next();
    const fullShare = source === "walk_in" ? 0.92 : 0.74;
    let amount = 0;
    if (roll < fullShare) amount = left;
    else if (roll < fullShare + 0.1 && !advance) amount = partAmount(rng, total, 0.4, 0.8) ?? left;
    if (amount > 0) await collect("collection", amount, t, floor);
  }
  return id;
}

/** Everything one venue did, day by day from the oldest to a week ahead. */
async function generateHistory(env: Env): Promise<void> {
  const { rng, now, biz } = env;
  const today = localDateOf(now, TZ);

  for (let offset = -HISTORY_DAYS; offset <= FUTURE_DAYS; offset++) {
    const date = addDays(today, offset);
    const weekend = [0, 6].includes(dayOfWeek(date));
    for (const loc of biz.locations) {
      const [lo, hi] = weekend ? loc.spec.perDay.weekend : loc.spec.perDay.weekday;
      const plans = Array.from({ length: rng.int(lo, hi) }, () => drawPlan(env, loc, date)).sort(
        (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
      );
      for (const plan of plans) {
        const phase: Phase = plan.endsAt <= now ? "past" : plan.startsAt <= now ? "live" : "future";
        const source: Source =
          phase === "past"
            ? rng.weighted([["online", 68], ["walk_in", 21], ["phone", 11]] as const)
            : phase === "live"
              ? rng.weighted([["online", 35], ["walk_in", 55], ["phone", 10]] as const)
              : rng.weighted([["online", 80], ["phone", 20]] as const);

        let requestedAt: Date;
        if (source === "walk_in") {
          requestedAt = new Date(plan.startsAt.getTime() - rng.int(0, 12) * MIN);
        } else if (phase === "future") {
          requestedAt = new Date(now.getTime() - rng.int(180, 3 * 1440) * MIN);
        } else if (source === "online") {
          const lead = 180 + Math.floor(-Math.log(1 - rng.next()) * 1500);
          requestedAt = new Date(plan.startsAt.getTime() - Math.min(lead, 6 * 1440) * MIN);
        } else {
          requestedAt = new Date(plan.startsAt.getTime() - rng.int(180, 4 * 1440) * MIN);
        }

        let outcome = chooseOutcome(env, phase, source);
        let customer = pickCustomer(env, source === "online");
        // The demo customer always has a couple of confirmed bookings coming up.
        if (phase === "future" && source === "online" && env.demoQuota > 0) {
          env.demoQuota--;
          customer = env.customers[0]!;
          outcome = "approved";
        }
        await runBooking(env, plan, { source, requestedAt, outcome, customer });
      }
    }
  }
}

/** Requests that arrived minutes ago and are still waiting, with deadlines spread out. */
async function createLivePending(env: Env, count: number, demoFirst: boolean): Promise<void> {
  const { rng, now, biz } = env;
  const hold = biz.spec.policy.pendingHoldMinutes;
  const today = localDateOf(now, TZ);
  const shares = [0.04, 0.14, 0.26, 0.38, 0.5, 0.65];
  const used = new Set<string>();

  for (let i = 0; i < count; i++) {
    const customer =
      demoFirst && i === 0
        ? env.customers[0]!
        : (() => {
            let c = pickCustomer(env, false);
            while (used.has(c.userId)) c = pickCustomer(env, false);
            return c;
          })();
    used.add(customer.userId);
    const requestedAt = new Date(now.getTime() - Math.max(1, Math.round(hold * shares[i % shares.length]!)) * MIN);

    for (let attempt = 0; attempt < 40; attempt++) {
      const loc = rng.weighted(biz.locations.map((l, n) => [l, n === 0 ? 4 : 1] as const));
      const plan = drawPlan(env, loc, addDays(today, rng.int(0, 3)));
      if (plan.startsAt.getTime() < now.getTime() + 4 * 60 * MIN) continue;
      const id = await runBooking(env, plan, { source: "online", requestedAt, outcome: "pending", customer });
      if (id) {
        env.livePending.push(id);
        break;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Reviews                                                             */
/* ------------------------------------------------------------------ */

function buildReviews(envs: Env[], now: Date) {
  const rows: (typeof reviews.$inferInsert)[] = [];
  for (const env of envs) {
    const { rng, biz } = env;
    for (const entry of env.ledger) {
      if (!rng.chance(0.45) || !entry.customer) continue;
      const rating = rng.weighted([[5, 50], [4, 30], [3, 12], [2, 5], [1, 3]] as const);
      const pool = rating >= 4 ? biz.spec.reviews.positive : rating === 3 ? biz.spec.reviews.neutral : biz.spec.reviews.negative;
      const createdAt = new Date(Math.min(entry.completedAt.getTime() + rng.int(3 * 60, 4 * 1440) * MIN, now.getTime() - 5 * MIN));
      const last = entry.customer.name.split(" ").slice(-1)[0]!;
      let businessResponse: string | null = null;
      let respondedAt: Date | null = null;
      if (rng.chance(rating <= 2 ? 0.8 : 0.12)) {
        businessResponse = rng.pick(rating <= 2 ? RESPONSES.apology : RESPONSES.thanks);
        respondedAt = new Date(Math.min(createdAt.getTime() + rng.int(120, 2880) * MIN, now.getTime() - MIN));
      }
      rows.push({
        bookingId: entry.bookingId,
        businessId: biz.id,
        locationId: entry.locationId,
        customerUserId: entry.customer.userId,
        authorName: `${entry.customer.name.split(" ")[0]} ${last[0]}.`,
        rating,
        body: rng.pick(pool),
        businessResponse,
        respondedAt,
        createdAt,
        updatedAt: respondedAt ?? createdAt,
      });
    }
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Wipes the database and fills it with the demo venues and their history.
 * `now` is the moment the story ends: history runs for 45 days before it and
 * bookings are open for a week after.
 */
export async function seedDemo(db: Db, opts: { now?: Date } = {}): Promise<SeedSummary> {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed a production database.");
  const now = opts.now ?? new Date();

  await truncateEverything(db);

  const planRows = await db.insert(subscriptionPlans).values(PLANS.map((p) => ({ ...p, limits: { ...p.limits }, features: { ...p.features } }))).returning();
  const plans = new Map(planRows.map((p) => [p.name, p.id]));
  const categoryRows = await db
    .insert(activityCategories)
    .values(CATEGORIES.map((c, i) => ({ ...c, sortOrder: i })))
    .returning();
  const categories = new Map(categoryRows.map((c) => [c.slug, c.id]));
  await db.insert(platformSettings).values({ key: "subscription_grace_days", value: 7 });

  // People. Customers are real users so they can sign in and see their bookings.
  const customerList = buildCustomerList();
  const staffUsers = [
    { phone: DEMO_LOGINS.superAdmin.phone, name: DEMO_LOGINS.superAdmin.name, isSuperAdmin: true },
    ...BUSINESSES.map((b) => ({ phone: b.owner.phone, name: b.owner.name, isSuperAdmin: false })),
    { phone: DEMO_LOGINS.manager.phone, name: DEMO_LOGINS.manager.name, isSuperAdmin: false },
    { phone: DEMO_LOGINS.staff.phone, name: DEMO_LOGINS.staff.name, isSuperAdmin: false },
  ];
  const created = new Date(now.getTime() - 100 * 24 * 60 * MIN);
  const userRows = await db
    .insert(users)
    .values([...staffUsers, ...customerList.map((c) => ({ ...c, isSuperAdmin: false }))].map((u) => ({ ...u, phoneVerifiedAt: created, createdAt: created, updatedAt: created })))
    .returning();
  const byPhone = new Map(userRows.map((u) => [u.phone, u.id]));
  const customers: Customer[] = customerList.map((c) => ({ ...c, userId: byPhone.get(c.phone)! }));

  const built: BuiltBusiness[] = [];
  for (const [index, spec] of BUSINESSES.entries()) {
    const first = index === 0;
    built.push(
      await insertVenue(
        db,
        spec,
        index,
        {
          ownerId: byPhone.get(spec.owner.phone)!,
          plans,
          categories,
          adminId: byPhone.get(DEMO_LOGINS.superAdmin.phone)!,
        },
        first ? { managerId: byPhone.get(DEMO_LOGINS.manager.phone)!, staffId: byPhone.get(DEMO_LOGINS.staff.phone)! } : {},
        now,
      ),
    );
  }

  // Each venue has its own stream of random numbers and its own resources, so
  // they can be generated side by side without affecting each other's result.
  const stats: Stats = { attempts: 0, skipped: 0 };
  const envs: Env[] = built.map((biz) => ({
    db,
    now,
    rng: makeRng(SEED + biz.index * 7919),
    biz,
    customers,
    ledger: [],
    stats,
    livePending: [],
    demoQuota: 2,
  }));
  await Promise.all(envs.map((env) => generateHistory(env)));

  // Live requests come last: a phone number may hold at most three at once.
  for (const env of envs) await createLivePending(env, 6, env.biz.index !== 1);

  // Past events were already "delivered" in this story. Only the requests that
  // are still waiting stay queued, so the worker notifies owners about those.
  const live = envs.flatMap((e) => e.livePending);
  await db
    .update(outboxEvents)
    .set({ status: "done", processedAt: now, attempts: 1 })
    .where(
      live.length
        ? sql`not (${outboxEvents.eventType} = 'booking.requested' and ${outboxEvents.payload}->>'bookingId' in (${sql.join(live.map((id) => sql`${id}`), sql`, `)}))`
        : undefined,
    );

  const reviewRows = buildReviews(envs, now);
  if (reviewRows.length) await db.insert(reviews).values(reviewRows);

  if (stats.attempts && stats.skipped / stats.attempts > 0.2) {
    console.warn(`Seed: ${stats.skipped} of ${stats.attempts} booking attempts were skipped. Check schedules and prices.`);
  }

  const count = async (table: string) => {
    const [row] = await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table}`));
    return row!.n;
  };

  return {
    businesses: built.length,
    bookings: await count("bookings"),
    payments: await count("payments"),
    reviews: await count("reviews"),
    logins: [
      { role: "super_admin", phone: DEMO_LOGINS.superAdmin.phone },
      ...BUSINESSES.map((b) => ({ role: "owner", phone: b.owner.phone, business: b.slug })),
      { role: "manager", phone: DEMO_LOGINS.manager.phone, business: BUSINESSES[0]!.slug },
      { role: "staff", phone: DEMO_LOGINS.staff.phone, business: BUSINESSES[0]!.slug },
      { role: "customer", phone: DEMO_LOGINS.customer.phone },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Running it as a script                                              */
/* ------------------------------------------------------------------ */

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const url = process.env.DATABASE_URL ?? "postgres://krello:krello@localhost:54329/krello";
  const { db, close } = createDb(url);
  try {
    const started = Date.now();
    const summary = await seedDemo(db);
    console.log(
      `Seeded ${summary.businesses} businesses, ${summary.bookings} bookings, ${summary.payments} payments and ${summary.reviews} reviews in ${((Date.now() - started) / 1000).toFixed(1)}s.\n`,
    );
    console.log("Demo logins (the development OTP is printed in the server console):");
    for (const l of summary.logins) {
      console.log(`  ${l.role.padEnd(12)} ${l.phone}${l.business ? `  (${l.business})` : ""}`);
    }
  } catch (e) {
    console.error(`Seeding failed: ${e instanceof Error ? e.message : e}`);
    console.error("Is the database running and migrated? Try: pnpm db:start, then pnpm db:migrate.");
    process.exitCode = 1;
  } finally {
    await close();
  }
}
