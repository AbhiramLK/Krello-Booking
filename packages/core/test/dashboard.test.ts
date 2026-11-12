import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { bookingStatusHistory, subscriptions, type Db } from "@krello/database";
import { addDays, createBlock, createBooking, EngineError, localDateOf, localToInstant, recordPayment, transitionBooking } from "@krello/booking-engine";
import { closeTestDb, CUSTOMER, customer, staff as ownerActor, testDb, TZ, type Venue } from "../../booking-engine/test/fixtures";
import { AppError, bookingActions, decideBooking, getBookingForTenant, getOverview, listBookingsForTenant } from "../src";
import { makeOtherBusiness, makeTeam, rejectsWith } from "./team";

process.env.SESSION_SECRET ??= "test-secret-at-least-16-chars";

let db: Db;
beforeAll(() => {
  db = testDb();
});
afterAll(closeTestDb);

const request = (locationId: string, resourceId: string, startsAt: Date, now?: Date) =>
  createBooking(db, {
    locationId,
    resourceIds: [resourceId],
    startsAt,
    endsAt: new Date(startsAt.getTime() + 60 * 60_000),
    groupSize: 2,
    customer: customer(),
    source: "online",
    actor: CUSTOMER,
    now,
  }).then((r) => r.booking);

/** Entered by the venue, so it starts approved. */
const phoneBooking = (v: Venue, locationId: string, resourceId: string, startsAt: Date, now?: Date) =>
  createBooking(db, {
    locationId,
    resourceIds: [resourceId],
    startsAt,
    endsAt: new Date(startsAt.getTime() + 60 * 60_000),
    groupSize: 2,
    customer: customer("Walk-in"),
    source: "phone",
    actor: ownerActor(v),
    now,
  }).then((r) => r.booking);

describe("tenant isolation", () => {
  it("does not show or change another business's booking", async () => {
    const a = await makeTeam(db);
    const other = await makeOtherBusiness(db);
    const b = await request(a.v.locationId, a.v.tables[0]!, a.v.at(18));

    expect(await getBookingForTenant(db, other, b.id)).toBeNull();
    await rejectsWith(decideBooking(db, other, { bookingId: b.id, action: "approve" }), EngineError, "not_found");
    expect((await getBookingForTenant(db, a.owner, b.id))?.booking.id).toBe(b.id);
  });
});

describe("staff assigned to one location", () => {
  it("cannot approve, but can mark a started booking as a no-show", async () => {
    const t = await makeTeam(db);
    const pending = await request(t.v.locationId, t.v.tables[0]!, t.v.at(18));
    const err = await rejectsWith(decideBooking(db, t.staff, { bookingId: pending.id, action: "approve" }), AppError, "forbidden");
    expect((err as AppError).status).toBe(403);
    await rejectsWith(decideBooking(db, t.staff, { bookingId: pending.id, action: "reject", reason: "Full" }), AppError, "forbidden");

    // Yesterday's booking has really started, so no clock needs faking.
    const yesterday = addDays(localDateOf(new Date(), TZ), -1);
    const start = localToInstant(yesterday, 10 * 60, TZ);
    const started = await phoneBooking(t.v, t.v.locationId, t.v.tables[1]!, start, new Date(start.getTime() - 2 * 86_400_000));
    const { booking } = await decideBooking(db, t.staff, { bookingId: started.id, action: "no_show" });
    expect(booking.status).toBe("no_show");
  });

  it("sees only bookings at the assigned location", async () => {
    const t = await makeTeam(db);
    const here = await request(t.v.locationId, t.v.tables[0]!, t.v.at(18));
    const there = await request(t.loc2, t.loc2Table, t.v.at(18));

    const list = await listBookingsForTenant(db, t.staff, {});
    const ids = list.items.map((b) => b.id);
    expect(ids).toContain(here.id);
    expect(ids).not.toContain(there.id);
    expect(list.items.every((b) => b.locationId === t.v.locationId)).toBe(true);
    // Asking for the other location by name does not widen the view.
    expect((await listBookingsForTenant(db, t.staff, { locationId: t.loc2 })).items).toEqual([]);
    // A caller-supplied location list cannot override the member's assignment.
    expect((await listBookingsForTenant(db, t.staff, { locationIds: null })).items.map((b) => b.id)).not.toContain(there.id);

    expect(await getBookingForTenant(db, t.staff, there.id)).toBeNull();
    await rejectsWith(decideBooking(db, t.staff, { bookingId: there.id, action: "no_show" }), EngineError, "not_found");

    // The owner sees both.
    const all = (await listBookingsForTenant(db, t.owner, {})).items.map((b) => b.id);
    expect(all).toEqual(expect.arrayContaining([here.id, there.id]));
  });

  it("gets overview figures for the assigned location only", async () => {
    const t = await makeTeam(db);
    const now = t.v.at(12);
    await phoneBooking(t.v, t.v.locationId, t.v.tables[0]!, t.v.at(14), t.v.at(9));
    await phoneBooking(t.v, t.loc2, t.loc2Table, t.v.at(14), t.v.at(9));
    await request(t.loc2, t.loc2Table, t.v.at(16), t.v.at(11, 50));

    const mine = await getOverview(db, t.staff, { now });
    expect(mine.todayConfirmed).toBe(1);
    expect(mine.todayBookingValue).toBe(30000);
    expect(mine.pendingCount).toBe(0);
    expect(mine.todayRequests).toBe(0);
    expect(mine.resourcesNow.map((r) => r.resourceId)).not.toContain(t.loc2Table);

    const everything = await getOverview(db, t.owner, { now });
    expect(everything.todayConfirmed).toBe(2);
    expect(everything.pendingCount).toBe(1);
    expect(everything.resourcesNow.map((r) => r.resourceId)).toContain(t.loc2Table);

    // A location the member may not open gives nothing rather than everything.
    const filtered = await getOverview(db, t.staff, { now, locationId: t.loc2 });
    expect(filtered.todayConfirmed).toBe(0);
    expect(filtered.resourcesNow).toEqual([]);
  });
});

describe("decisions", () => {
  it("records the manager who approved a request", async () => {
    const t = await makeTeam(db);
    const pending = await request(t.v.locationId, t.v.tables[0]!, t.v.at(18));
    const { booking } = await decideBooking(db, t.manager, { bookingId: pending.id, action: "approve" });
    expect(booking.status).toBe("approved");

    const [last] = await db
      .select()
      .from(bookingStatusHistory)
      .where(eq(bookingStatusHistory.bookingId, pending.id))
      .orderBy(desc(bookingStatusHistory.createdAt))
      .limit(1);
    expect(last!.toStatus).toBe("approved");
    expect(last!.actorKind).toBe("business");
    expect(last!.actorUserId).toBe(t.manager.user.id);
  });

  it("refuses decisions while the subscription has expired", async () => {
    const t = await makeTeam(db);
    const pending = await request(t.v.locationId, t.v.tables[0]!, t.v.at(18));
    await db.update(subscriptions).set({ status: "expired" }).where(eq(subscriptions.businessId, t.v.businessId));
    await rejectsWith(decideBooking(db, t.owner, { bookingId: pending.id, action: "approve" }), EngineError, "read_only");
  });
});

describe("getOverview", () => {
  it("adds up today's value, collections, requests and cancellations", async () => {
    const t = await makeTeam(db);
    const { v } = t;
    const now = v.at(12);

    // ₹300: one table for one hour before the evening peak, entered by the venue.
    const approved = await phoneBooking(v, v.locationId, v.tables[0]!, v.at(14), v.at(9));
    // A live request: its 30-minute hold runs to 12:15.
    const pending = await request(v.locationId, v.tables[1]!, v.at(15), v.at(11, 45));
    // An overdue request: its hold ran out at 11:30, so it is not counted as pending.
    await request(v.locationId, v.tables[2]!, v.at(19), v.at(11));
    const cancelled = await phoneBooking(v, v.locationId, v.tables[2]!, v.at(16), v.at(9));
    await transitionBooking(db, {
      bookingId: cancelled.id,
      action: "cancel_by_business",
      actor: ownerActor(v),
      reason: "Table repair",
      now: v.at(10),
    });
    await recordPayment(db, {
      businessId: v.businessId,
      bookingId: approved.id,
      kind: "collection",
      amount: 10000,
      method: "cash",
      collectedAt: v.at(11),
      actor: ownerActor(v),
    });

    const o = await getOverview(db, t.owner, { now });
    expect(o.todayBookingValue).toBe(30000);
    expect(o.todayCollected).toBe(10000);
    expect(o.pendingCount).toBe(1);
    expect(o.todayCancelled).toBe(1);
    expect(o.todayConfirmed).toBe(1);
    expect(o.todayRequests).toBe(2);
    expect(o.pending.map((b) => b.id)).toEqual([pending.id]);
    expect(o.upcoming.map((b) => b.id)).toEqual([approved.id]);

    // A refund recorded today comes off the collected figure.
    await recordPayment(db, {
      businessId: v.businessId,
      bookingId: approved.id,
      kind: "refund",
      amount: 2500,
      method: "cash",
      collectedAt: v.at(11, 30),
      actor: ownerActor(v),
    });
    expect((await getOverview(db, t.owner, { now })).todayCollected).toBe(7500);
  });

  it("says which resources are free, occupied or blocked right now", async () => {
    const t = await makeTeam(db);
    const { v } = t;
    await phoneBooking(v, v.locationId, v.tables[0]!, v.at(14), v.at(9));
    // A request holds its slot but nobody is playing on it yet.
    await request(v.locationId, v.tables[1]!, v.at(14), v.at(13, 50));
    await createBlock(db, {
      businessId: v.businessId,
      resourceId: v.tables[2]!,
      startsAt: v.at(13),
      endsAt: v.at(16),
      reason: "Cloth change",
      actor: ownerActor(v),
    });

    const o = await getOverview(db, t.owner, { now: v.at(14, 30), locationId: v.locationId });
    const state = (id: string) => o.resourcesNow.find((r) => r.resourceId === id)?.state;
    expect(state(v.tables[0]!)).toBe("occupied");
    expect(state(v.tables[1]!)).toBe("free");
    expect(state(v.tables[2]!)).toBe("blocked");
    expect(o.resourcesNow.every((r) => r.locationName === "Main")).toBe(true);
  });
});

describe("bookingActions", () => {
  const at = (h: number) => new Date(Date.UTC(2030, 0, 1, h));
  const row = (over: Partial<Parameters<typeof bookingActions>[1]>) => ({
    status: "pending" as const,
    pendingExpiresAt: at(12),
    startsAt: at(14),
    ...over,
  });

  it("offers what the role and status allow", async () => {
    const t = await makeTeam(db);
    expect(bookingActions(t.owner, row({}), at(11))).toEqual(["approve", "reject"]);
    expect(bookingActions(t.staff, row({}), at(11))).toEqual([]);
    // An overdue request is not offered for a decision.
    expect(bookingActions(t.owner, row({}), at(13))).toEqual([]);
    expect(bookingActions(t.owner, row({ status: "approved", pendingExpiresAt: null }), at(11))).toEqual(["cancel_by_business"]);
    expect(bookingActions(t.owner, row({ status: "approved", pendingExpiresAt: null }), at(15))).toEqual([
      "complete",
      "no_show",
      "cancel_by_business",
    ]);
    expect(bookingActions(t.staff, row({ status: "approved", pendingExpiresAt: null }), at(15))).toEqual(["complete", "no_show"]);
    expect(bookingActions(t.owner, row({ status: "completed", pendingExpiresAt: null }), at(15))).toEqual([]);
  });
});

