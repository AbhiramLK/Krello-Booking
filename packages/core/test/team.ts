import { expect } from "vitest";
import { eq } from "drizzle-orm";
import {
  businessMemberships,
  locationHours,
  locations,
  pricingRules,
  resourceSchedules,
  resources,
  users,
  type Db,
} from "@krello/database";
import { EngineError } from "@krello/booking-engine";
import { makeVenue, newPhone, TZ, type Venue } from "../../booking-engine/test/fixtures";
import { AppError, getTenantContext, type TenantContext } from "../src";

// Shared by the tenant-scoped use case tests (dashboard, calendar): a venue
// with a team whose members see different parts of it.

export interface Team {
  v: Venue;
  /** A second location with one table. */
  loc2: string;
  loc2Table: string;
  owner: TenantContext;
  manager: TenantContext;
  /** Assigned to location 1 only. */
  staff: TenantContext;
}

async function newUser(db: Db, name: string) {
  const [u] = await db.insert(users).values({ phone: newPhone(), phoneVerifiedAt: new Date(), name }).returning();
  return u!;
}

export async function contextFor(db: Db, userId: string, businessId: string): Promise<TenantContext> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const ctx = await getTenantContext(db, user!, businessId);
  if (!ctx) throw new Error("no membership");
  return ctx;
}

/** A venue with two locations, an owner, a manager and a staff member on location 1. */
export async function makeTeam(db: Db): Promise<Team> {
  const v = await makeVenue(db);
  const [loc] = await db
    .insert(locations)
    .values({
      businessId: v.businessId,
      name: "Second",
      slug: "second",
      address: "2 Test Road",
      locality: "Koramangala",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560034",
      timezone: TZ,
    })
    .returning();
  const base = { businessId: v.businessId, locationId: loc!.id };
  const [table] = await db.insert(resources).values({ ...base, name: "Far table", resourceType: "table", capacity: 4, advanceDays: 30 }).returning();
  await db.insert(locationHours).values([0, 1, 2, 3, 4, 5, 6].map((d) => ({ ...base, dayOfWeek: d, opensMinute: 9 * 60, closesMinute: 23 * 60 })));
  await db.insert(resourceSchedules).values(
    [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      businessId: v.businessId,
      resourceId: table!.id,
      dayOfWeek: d,
      opensMinute: 10 * 60,
      closesMinute: 22 * 60,
      slotDurationMinutes: 60,
      slotIntervalMinutes: 60,
    })),
  );
  await db.insert(pricingRules).values({ ...base, resourceId: table!.id, ruleType: "base", amount: 30000 });

  const manager = await newUser(db, "Manager");
  const staffUser = await newUser(db, "Staff");
  await db.insert(businessMemberships).values([
    { businessId: v.businessId, userId: v.ownerId, role: "owner", locationIds: [] },
    { businessId: v.businessId, userId: manager.id, role: "manager", locationIds: [] },
    { businessId: v.businessId, userId: staffUser.id, role: "staff", locationIds: [v.locationId] },
  ]);
  return {
    v,
    loc2: loc!.id,
    loc2Table: table!.id,
    owner: await contextFor(db, v.ownerId, v.businessId),
    manager: await contextFor(db, manager.id, v.businessId),
    staff: await contextFor(db, staffUser.id, v.businessId),
  };
}

/** A second business with only its owner. */
export async function makeOtherBusiness(db: Db): Promise<TenantContext> {
  const v = await makeVenue(db);
  await db.insert(businessMemberships).values({ businessId: v.businessId, userId: v.ownerId, role: "owner", locationIds: [] });
  return contextFor(db, v.ownerId, v.businessId);
}

/** Rejects with an error of this class and code. */
export async function rejectsWith(p: Promise<unknown>, cls: typeof AppError | typeof EngineError, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(cls);
  expect((e as { code: string }).code).toBe(code);
  return e as AppError | EngineError;
}
