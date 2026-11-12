import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { bookings, businessMemberships, notifications, otpChallenges, outboxEvents, users, type Db } from "@krello/database";
import { createBooking, transitionBooking } from "@krello/booking-engine";
import { runWorkerOnce } from "../../../scripts/worker";
import { closeTestDb, CUSTOMER, makeVenue, newPhone, staff, testDb } from "../../booking-engine/test/fixtures";

process.env.SESSION_SECRET ??= "test-secret-at-least-16-chars";

let db: Db;
beforeAll(async () => {
  db = testDb();
  // The database is shared with the other test files and the worker is not scoped
  // to one business. Settle everything left over first, far in the future, so the
  // counts asserted below are only this file's own work.
  const later = new Date(Date.now() + 60 * 86_400_000);
  for (;;) {
    const r = await runWorkerOnce(db, later);
    if (!r.expired && !r.notified && !r.failed) break;
  }
});
afterAll(closeTestDb);

const request = (v: Awaited<ReturnType<typeof makeVenue>>, userId?: string, phone = newPhone()) =>
  createBooking(db, {
    locationId: v.locationId,
    resourceIds: [v.tables[0]!],
    startsAt: v.at(18),
    endsAt: v.at(19),
    groupSize: 2,
    customer: { name: "Asha Rao", phone, userId },
    source: "online",
    actor: CUSTOMER,
  });

const titlesFor = async (userId: string) =>
  (await db.select({ title: notifications.title }).from(notifications).where(eq(notifications.recipientUserId, userId))).map((n) => n.title);

describe("runWorkerOnce", () => {
  it("expires an overdue request, tells the owner once, and has nothing to do the second time", async () => {
    const v = await makeVenue(db);
    await db.insert(businessMemberships).values({ businessId: v.businessId, userId: v.ownerId, role: "owner", locationIds: [] });
    const { booking } = await request(v);

    // Before the deadline there is nothing to expire; the "New booking request" event is delivered.
    const early = await runWorkerOnce(db, new Date(booking.pendingExpiresAt!.getTime() - 60_000));
    expect(early.expired).toBe(0);
    expect(early.notified).toBeGreaterThanOrEqual(1);
    expect(await titlesFor(v.ownerId)).toEqual(["New booking request"]);

    const late = new Date(booking.pendingExpiresAt!.getTime() + 60_000);
    const first = await runWorkerOnce(db, late);
    expect(first).toEqual({ expired: 1, notified: 1, failed: 0 });

    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row!.status).toBe("expired");
    expect((await titlesFor(v.ownerId)).sort()).toEqual(["New booking request", "Request expired"]);

    expect(await runWorkerOnce(db, late)).toEqual({ expired: 0, notified: 0, failed: 0 });
    expect(await db.select().from(outboxEvents).where(and(eq(outboxEvents.status, "pending")))).toHaveLength(0);
  });

  it("gives the signed-in customer a Booking confirmed notification once a request is approved", async () => {
    const v = await makeVenue(db);
    await db.insert(businessMemberships).values({ businessId: v.businessId, userId: v.ownerId, role: "owner", locationIds: [] });
    const [customer] = await db.insert(users).values({ phone: newPhone(), phoneVerifiedAt: new Date(), name: "Asha" }).returning();
    const { booking } = await request(v, customer!.id, customer!.phone);
    await transitionBooking(db, { bookingId: booking.id, action: "approve", actor: staff(v), businessId: v.businessId });

    const r = await runWorkerOnce(db);
    expect(r.failed).toBe(0);
    expect(r.notified).toBeGreaterThanOrEqual(2);
    expect(await titlesFor(customer!.id)).toEqual(["Booking confirmed"]);
  });

  it("removes one-time codes that expired long ago", async () => {
    const old = new Date(Date.now() - 3 * 3_600_000);
    await db.insert(otpChallenges).values({ phone: newPhone(), codeHash: "x", expiresAt: old, createdAt: old });
    const fresh = await db.insert(otpChallenges).values({ phone: newPhone(), codeHash: "y", expiresAt: new Date(Date.now() + 60_000) }).returning();
    await runWorkerOnce(db);
    const left = await db.select().from(otpChallenges);
    expect(left.some((c) => c.codeHash === "x")).toBe(false);
    expect(left.some((c) => c.id === fresh[0]!.id)).toBe(true);
  });
});
