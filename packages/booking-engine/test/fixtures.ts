import { randomUUID } from "node:crypto";
import {
  businesses,
  createDb,
  locationHours,
  locations,
  pricingRules,
  resourceSchedules,
  resources,
  subscriptionPlans,
  subscriptions,
  users,
  type Db,
  type DbHandle,
} from "@krello/database";
import { addDays, localDateOf, localToInstant } from "../src";

export const TZ = "Asia/Kolkata";

let handle: DbHandle | undefined;

export function testDb(): Db {
  if (!handle) {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error("TEST_DATABASE_URL is not set; run through vitest");
    handle = createDb(url, { max: 20 });
  }
  return handle.db;
}

export async function closeTestDb() {
  await handle?.close();
  handle = undefined;
}

export interface Venue {
  businessId: string;
  locationId: string;
  ownerId: string;
  /** Three exclusive tables with 60-minute slots, 10:00–22:00 daily. */
  tables: string[];
  /** A shared session with 10 places, 60-minute slots. */
  session: string;
  /** A date a few days ahead, as YYYY-MM-DD in the venue's timezone. */
  date: string;
  at: (hour: number, minute?: number) => Date;
}

/** Builds an approved, subscribed venue with its own rows, isolated per test. */
export async function makeVenue(
  db: Db,
  opts: { policy?: Record<string, unknown>; subscription?: "trialing" | "active" | "grace" | "expired" } = {},
): Promise<Venue> {
  const tag = randomUUID().slice(0, 8);
  const [owner] = await db
    .insert(users)
    .values({ phone: `+9199${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`, name: "Owner" })
    .returning();
  const [biz] = await db
    .insert(businesses)
    .values({
      ownerUserId: owner!.id,
      name: `Venue ${tag}`,
      slug: `venue-${tag}`,
      verificationStatus: "approved",
      policy: opts.policy ?? {},
    })
    .returning();
  const [plan] = await db
    .insert(subscriptionPlans)
    .values({ name: `Plan ${tag}`, priceAmount: 99900 })
    .returning();
  await db.insert(subscriptions).values({ businessId: biz!.id, planId: plan!.id, status: opts.subscription ?? "active" });
  const [loc] = await db
    .insert(locations)
    .values({
      businessId: biz!.id,
      name: "Main",
      slug: "main",
      address: "1 Test Road",
      locality: "Indiranagar",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560038",
      timezone: TZ,
    })
    .returning();
  const base = { businessId: biz!.id, locationId: loc!.id };

  const tableRows = await db
    .insert(resources)
    .values([1, 2, 3].map((n) => ({ ...base, name: `Table ${n}`, resourceType: "table", capacity: 4, advanceDays: 30 })))
    .returning();
  const [session] = await db
    .insert(resources)
    .values({
      ...base,
      name: "Open swim",
      resourceType: "session",
      bookingMode: "shared",
      capacity: 10,
      priceUnit: "per_slot",
      pricePerPerson: true,
      advanceDays: 30,
    })
    .returning();

  const all = [...tableRows, session!];
  await db.insert(locationHours).values(
    [0, 1, 2, 3, 4, 5, 6].map((d) => ({ ...base, dayOfWeek: d, opensMinute: 9 * 60, closesMinute: 23 * 60 })),
  );
  await db.insert(resourceSchedules).values(
    all.flatMap((r) =>
      [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        businessId: biz!.id,
        resourceId: r.id,
        dayOfWeek: d,
        opensMinute: 10 * 60,
        closesMinute: 22 * 60,
        slotDurationMinutes: 60,
        slotIntervalMinutes: 60,
      })),
    ),
  );
  await db.insert(pricingRules).values([
    ...tableRows.map((r) => ({ ...base, resourceId: r.id, ruleType: "base" as const, amount: 30000 })),
    ...tableRows.map((r) => ({
      ...base,
      resourceId: r.id,
      ruleType: "time_of_day" as const,
      label: "Evening peak",
      startMinute: 17 * 60,
      endMinute: 22 * 60,
      amount: 40000,
    })),
    { ...base, resourceId: session!.id, ruleType: "base" as const, amount: 15000 },
  ]);

  const date = addDays(localDateOf(new Date(), TZ), 3);
  return {
    businessId: biz!.id,
    locationId: loc!.id,
    ownerId: owner!.id,
    tables: tableRows.map((r) => r.id),
    session: session!.id,
    date,
    at: (hour, minute = 0) => localToInstant(date, hour * 60 + minute, TZ),
  };
}

let phoneSeq = 0;
export const newPhone = () => `+9198${String(Date.now() % 1e4).padStart(4, "0")}${String(phoneSeq++).padStart(4, "0")}`;

export const customer = (name = "Asha") => ({ name, phone: newPhone() });
export const CUSTOMER = { kind: "customer" as const };
export const staff = (v: Venue) => ({ kind: "business" as const, userId: v.ownerId });
