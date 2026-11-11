import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, bookingAllocations, bookingStatusHistory, bookings, outboxEvents, resourceSchedules, type Db } from "@krello/database";
import {
  createBlock,
  createBooking,
  EngineError,
  expireOverdueBookings,
  getAvailability,
  recordPayment,
  transitionBooking,
  type CreateBookingInput,
} from "../src";
import { closeTestDb, customer, CUSTOMER, makeVenue, staff, testDb, type Venue } from "./fixtures";

let db: Db;
beforeAll(() => {
  db = testDb();
});
afterAll(closeTestDb);

function online(v: Venue, resourceIds: string[], hour: number, extra: Partial<CreateBookingInput> = {}): CreateBookingInput {
  return {
    locationId: v.locationId,
    resourceIds,
    startsAt: v.at(hour),
    endsAt: v.at(hour + 1),
    customer: customer(),
    groupSize: 2,
    source: "online",
    actor: CUSTOMER,
    ...extra,
  };
}

async function activeAllocations(bookingId: string) {
  return db
    .select()
    .from(bookingAllocations)
    .where(and(eq(bookingAllocations.bookingId, bookingId), inArray(bookingAllocations.status, ["held", "confirmed"])));
}

async function slotState(v: Venue, resourceId: string, hour: number) {
  const a = await getAvailability(db, { locationId: v.locationId, date: v.date, resourceIds: [resourceId] });
  return a.resources[0]!.slots.find((s) => s.startMinute === hour * 60)!;
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e) => (e instanceof EngineError ? e.code : `unexpected: ${e}`),
  );

describe("double-booking prevention", () => {
  it("lets exactly one of many simultaneous requests for the same slot succeed", async () => {
    const v = await makeVenue(db);
    const results = await Promise.all(
      Array.from({ length: 12 }, () => code(createBooking(db, online(v, [v.tables[0]!], 14)))),
    );
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "slot_conflict")).toHaveLength(11);
    expect((await slotState(v, v.tables[0]!, 14)).state).toBe("pending_hold");
  });

  it("refuses overlapping multi-resource requests atomically, with no partial hold", async () => {
    const v = await makeVenue(db);
    const [t1, t2, t3] = v.tables as [string, string, string];
    const results = await Promise.all([
      code(createBooking(db, online(v, [t1, t2], 15))),
      code(createBooking(db, online(v, [t2, t3], 15))),
      code(createBooking(db, online(v, [t3, t1], 15))),
    ]);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    // Exactly two tables are held; the third is untouched by the losers.
    const states = await Promise.all([t1, t2, t3].map((t) => slotState(v, t, 15)));
    expect(states.filter((s) => s.state === "pending_hold")).toHaveLength(2);
    expect(states.filter((s) => s.state === "available")).toHaveLength(1);
  });

  it("fails the whole request when one resource in it is taken", async () => {
    const v = await makeVenue(db);
    await createBooking(db, online(v, [v.tables[1]!], 16));
    expect(await code(createBooking(db, online(v, [v.tables[0]!, v.tables[1]!], 16)))).toBe("slot_conflict");
    expect((await slotState(v, v.tables[0]!, 16)).state).toBe("available");
  });

  it("makes a phone booking conflict with an online request, and the reverse", async () => {
    const v = await makeVenue(db);
    const phone: CreateBookingInput = { ...online(v, [v.tables[0]!], 11), source: "phone", actor: staff(v) };
    const { booking } = await createBooking(db, phone);
    expect(booking.status).toBe("approved");
    expect((await slotState(v, v.tables[0]!, 11)).state).toBe("confirmed");
    expect(await code(createBooking(db, online(v, [v.tables[0]!], 11)))).toBe("slot_conflict");

    // A walk-in cannot take a slot that an online request is holding.
    await createBooking(db, online(v, [v.tables[0]!], 12));
    const walkIn: CreateBookingInput = { ...online(v, [v.tables[0]!], 12), source: "walk_in", actor: staff(v) };
    expect(await code(createBooking(db, walkIn))).toBe("slot_conflict");
  });

  it("is enforced by the database even if application checks are bypassed", async () => {
    const v = await makeVenue(db);
    const { booking } = await createBooking(db, online(v, [v.tables[0]!], 13));
    const [alloc] = await activeAllocations(booking.id);
    await expect(
      db.insert(bookingAllocations).values({ ...alloc!, id: undefined, startsAt: v.at(13, 30), endsAt: v.at(14, 30) }),
    ).rejects.toMatchObject({ cause: { code: "23P01" } });
  });

  it("counts places on a shared resource and refuses overbooking under concurrency", async () => {
    const v = await makeVenue(db);
    // 10 places; six requests of 3 people each: only three fit.
    const results = await Promise.all(
      Array.from({ length: 6 }, () => code(createBooking(db, online(v, [v.session], 10, { groupSize: 3 })))),
    );
    expect(results.filter((r) => r === "ok")).toHaveLength(3);
    expect((await slotState(v, v.session, 10)).remaining).toBe(1);
  });

  it("returns the original booking for a repeated submission with the same idempotency key", async () => {
    const v = await makeVenue(db);
    const input = online(v, [v.tables[0]!], 18, { idempotencyKey: "retry-1" });
    const [a, b] = await Promise.all([createBooking(db, input), createBooking(db, input)]);
    expect(a.booking.id).toBe(b.booking.id);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
  });
});

describe("slot validation", () => {
  it("rejects times that are not generated slots, and accepts consecutive slots", async () => {
    const v = await makeVenue(db);
    const t = [v.tables[0]!];
    expect(await code(createBooking(db, { ...online(v, t, 10), startsAt: v.at(10, 30), endsAt: v.at(11, 30) }))).toBe("validation");
    expect(await code(createBooking(db, { ...online(v, t, 22) }))).toBe("validation"); // after closing
    const { booking } = await createBooking(db, { ...online(v, t, 10), endsAt: v.at(12) });
    expect(booking.totalAmount).toBe(60000); // 2 h at ₹300
  });

  it("splits the price where a booking crosses into peak hours and snapshots it", async () => {
    const v = await makeVenue(db);
    const { booking } = await createBooking(db, { ...online(v, [v.tables[0]!], 16), endsAt: v.at(18) });
    expect(booking.totalAmount).toBe(30000 + 40000);
    const snap = booking.priceSnapshot as { allocations: { price: { segments: unknown[] } }[] };
    expect(snap.allocations[0]!.price.segments).toHaveLength(2);
  });

  it("does not offer or accept a blocked slot, and refuses a block over a live booking", async () => {
    const v = await makeVenue(db);
    const t = v.tables[0]!;
    await createBlock(db, { businessId: v.businessId, resourceId: t, startsAt: v.at(10), endsAt: v.at(12), reason: "Re-felting", actor: staff(v) });
    expect((await slotState(v, t, 11)).state).toBe("blocked");
    expect(await code(createBooking(db, online(v, [t], 11)))).toBe("slot_conflict");

    await createBooking(db, online(v, [t], 14));
    expect(
      await code(createBlock(db, { businessId: v.businessId, resourceId: t, startsAt: v.at(13), endsAt: v.at(15), actor: staff(v) })),
    ).toBe("slot_conflict");
  });

  it("keeps existing bookings when the schedule changes afterwards", async () => {
    const v = await makeVenue(db);
    const t = v.tables[0]!;
    const { booking } = await createBooking(db, online(v, [t], 20));
    await transitionBooking(db, { bookingId: booking.id, action: "approve", actor: staff(v), businessId: v.businessId });
    // The owner shortens the day so 20:00 is no longer a slot.
    await db.update(resourceSchedules).set({ closesMinute: 18 * 60 }).where(eq(resourceSchedules.resourceId, t));
    const a = await getAvailability(db, { locationId: v.locationId, date: v.date, resourceIds: [t] });
    expect(a.resources[0]!.slots.some((s) => s.startMinute === 20 * 60)).toBe(false);
    const [still] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(still!.status).toBe("approved");
    expect(await activeAllocations(booking.id)).toHaveLength(1);
  });
});

describe("lifecycle", () => {
  it("holds on request, confirms on approval, and writes history, audit and outbox rows", async () => {
    const v = await makeVenue(db);
    const { booking } = await createBooking(db, online(v, [v.tables[0]!, v.tables[1]!], 14));
    expect(booking.status).toBe("pending");
    expect(booking.pendingExpiresAt).not.toBeNull();
    expect((await activeAllocations(booking.id)).every((a) => a.status === "held")).toBe(true);

    const r = await transitionBooking(db, { bookingId: booking.id, action: "approve", actor: staff(v), businessId: v.businessId });
    expect(r.booking.status).toBe("approved");
    expect((await activeAllocations(booking.id)).every((a) => a.status === "confirmed")).toBe(true);

    const history = await db.select().from(bookingStatusHistory).where(eq(bookingStatusHistory.bookingId, booking.id));
    expect(history.map((h) => h.toStatus).sort()).toEqual(["approved", "pending"]);
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.targetId, booking.id));
    expect(audit.map((a) => a.action).sort()).toEqual(["booking.approved", "booking.created"]);
    const events = await db.select().from(outboxEvents).where(eq(outboxEvents.businessId, v.businessId));
    expect(events.map((e) => e.eventType).sort()).toEqual(["booking.approved", "booking.requested"]);
  });

  it("releases the slot on rejection, and a rejection needs a reason", async () => {
    const v = await makeVenue(db);
    const { booking } = await createBooking(db, online(v, [v.tables[0]!], 14));
    const base = { bookingId: booking.id, action: "reject" as const, actor: staff(v), businessId: v.businessId };
    expect(await code(transitionBooking(db, base))).toBe("validation");
    await transitionBooking(db, { ...base, reason: "Tournament night" });
    expect(await activeAllocations(booking.id)).toHaveLength(0);
    expect((await slotState(v, v.tables[0]!, 14)).state).toBe("available");
    // The released slot can be booked again.
    expect(await code(createBooking(db, online(v, [v.tables[0]!], 14)))).toBe("ok");
  });

  it("expires overdue requests once, however many times the job runs", async () => {
    const v = await makeVenue(db, { policy: { pendingHoldMinutes: 30 } });
    const { booking } = await createBooking(db, online(v, [v.tables[0]!], 14));
    const later = new Date(booking.pendingExpiresAt!.getTime() + 1000);

    expect(await expireOverdueBookings(db, { now: new Date(), businessId: v.businessId })).toBe(0); // not due yet
    const runs = await Promise.all([1, 2, 3, 4].map(() => expireOverdueBookings(db, { now: later, businessId: v.businessId })));
    expect(runs.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await expireOverdueBookings(db, { now: later, businessId: v.businessId })).toBe(0);

    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row!.status).toBe("expired");
    const history = await db.select().from(bookingStatusHistory).where(eq(bookingStatusHistory.bookingId, booking.id));
    expect(history.filter((h) => h.toStatus === "expired")).toHaveLength(1);
    expect((await slotState(v, v.tables[0]!, 14)).state).toBe("available");
  });

  it("allows approval just before expiry and refuses it just after", async () => {
    const v = await makeVenue(db);
    const a = await createBooking(db, online(v, [v.tables[0]!], 14));
    const b = await createBooking(db, online(v, [v.tables[1]!], 14));
    const deadline = a.booking.pendingExpiresAt!.getTime();
    const base = { action: "approve" as const, actor: staff(v), businessId: v.businessId };

    const ok = await transitionBooking(db, { ...base, bookingId: a.booking.id, now: new Date(deadline - 1000) });
    expect(ok.booking.status).toBe("approved");

    const late = transitionBooking(db, { ...base, bookingId: b.booking.id, now: new Date(b.booking.pendingExpiresAt!.getTime() + 1000) });
    await expect(late).rejects.toMatchObject({ code: "invalid_transition" });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, b.booking.id));
    expect(row!.status).toBe("expired");
    expect(await activeAllocations(b.booking.id)).toHaveLength(0);
    // An expired booking cannot be revived.
    expect(await code(transitionBooking(db, { ...base, bookingId: b.booking.id }))).toBe("invalid_transition");
  });

  it("decides a race between approval and expiry one way only", async () => {
    const v = await makeVenue(db);
    const { booking } = await createBooking(db, online(v, [v.tables[0]!], 14));
    const justBefore = new Date(booking.pendingExpiresAt!.getTime() - 1);
    const justAfter = new Date(booking.pendingExpiresAt!.getTime() + 1);
    await Promise.all([
      code(transitionBooking(db, { bookingId: booking.id, action: "approve", actor: staff(v), businessId: v.businessId, now: justBefore })),
      expireOverdueBookings(db, { now: justAfter, businessId: v.businessId }),
    ]);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    const active = await activeAllocations(booking.id);
    if (row!.status === "approved") expect(active.every((a) => a.status === "confirmed")).toBe(true);
    else {
      expect(row!.status).toBe("expired");
      expect(active).toHaveLength(0);
    }
    const history = await db.select().from(bookingStatusHistory).where(eq(bookingStatusHistory.bookingId, booking.id));
    expect(history).toHaveLength(2);
  });

  it("lets a customer cancel a pending request and an approved booking within policy", async () => {
    const v = await makeVenue(db, { policy: { cancellationDeadlineMinutes: 120 } });
    const p = await createBooking(db, online(v, [v.tables[0]!], 14));
    await transitionBooking(db, { bookingId: p.booking.id, action: "cancel_by_customer", actor: CUSTOMER });
    expect((await slotState(v, v.tables[0]!, 14)).state).toBe("available");

    const a = await createBooking(db, online(v, [v.tables[0]!], 14));
    await transitionBooking(db, { bookingId: a.booking.id, action: "approve", actor: staff(v), businessId: v.businessId });
    const tooLate = new Date(a.booking.startsAt.getTime() - 60 * 60000);
    expect(await code(transitionBooking(db, { bookingId: a.booking.id, action: "cancel_by_customer", actor: CUSTOMER, now: tooLate }))).toBe("policy");
    const r = await transitionBooking(db, { bookingId: a.booking.id, action: "cancel_by_customer", actor: CUSTOMER });
    expect(r.booking.status).toBe("cancelled_by_customer");
    expect(await activeAllocations(a.booking.id)).toHaveLength(0);
  });

  it("respects a policy that forbids online cancellation", async () => {
    const v = await makeVenue(db, { policy: { customerCanCancelPending: false } });
    const { booking } = await createBooking(db, online(v, [v.tables[0]!], 14));
    expect(await code(transitionBooking(db, { bookingId: booking.id, action: "cancel_by_customer", actor: CUSTOMER }))).toBe("policy");
  });

  it("lets the business cancel an approved booking with a reason, releasing the slot", async () => {
    const v = await makeVenue(db);
    const { booking } = await createBooking(db, online(v, [v.tables[0]!], 14));
    const base = { bookingId: booking.id, actor: staff(v), businessId: v.businessId };
    await transitionBooking(db, { ...base, action: "approve" });
    expect(await code(transitionBooking(db, { ...base, action: "cancel_by_business" }))).toBe("validation");
    const r = await transitionBooking(db, { ...base, action: "cancel_by_business", reason: "Power cut" });
    expect(r.booking.cancellationReason).toBe("Power cut");
    expect((await slotState(v, v.tables[0]!, 14)).state).toBe("available");
  });

  it("only completes or marks no-show after the start time, and never from a terminal state", async () => {
    const v = await makeVenue(db);
    const { booking } = await createBooking(db, online(v, [v.tables[0]!], 14));
    const base = { bookingId: booking.id, actor: staff(v), businessId: v.businessId };
    expect(await code(transitionBooking(db, { ...base, action: "complete" }))).toBe("invalid_transition"); // still pending
    await transitionBooking(db, { ...base, action: "approve" });
    expect(await code(transitionBooking(db, { ...base, action: "complete" }))).toBe("validation"); // not started
    const after = new Date(booking.endsAt.getTime() + 60000);
    await transitionBooking(db, { ...base, action: "complete", now: after });
    for (const action of ["approve", "reject", "no_show", "cancel_by_business", "cancel_by_customer"] as const) {
      expect(await code(transitionBooking(db, { ...base, action, reason: "x", now: after }))).toBe("invalid_transition");
    }
  });
});

describe("tenant rules", () => {
  it("does not let one business act on another's booking", async () => {
    const a = await makeVenue(db);
    const b = await makeVenue(db);
    const { booking } = await createBooking(db, online(a, [a.tables[0]!], 14));
    expect(await code(transitionBooking(db, { bookingId: booking.id, action: "approve", actor: staff(b), businessId: b.businessId }))).toBe("not_found");
    expect(await code(recordPayment(db, { businessId: b.businessId, bookingId: booking.id, kind: "collection", amount: 100, method: "cash", actor: staff(b) }))).toBe("not_found");
    expect(await code(createBlock(db, { businessId: b.businessId, resourceId: a.tables[0]!, startsAt: a.at(10), endsAt: a.at(11), actor: staff(b) }))).toBe("not_found");
  });

  it("stops online requests and dashboard changes when the subscription has expired", async () => {
    const v = await makeVenue(db, { subscription: "expired" });
    expect(await code(createBooking(db, online(v, [v.tables[0]!], 14)))).toBe("not_bookable");
    expect(await code(createBooking(db, { ...online(v, [v.tables[0]!], 14), source: "walk_in", actor: staff(v) }))).toBe("read_only");
  });

  it("caps how many pending requests one phone number can hold", async () => {
    const v = await makeVenue(db);
    const who = customer("Ravi");
    for (const h of [10, 11, 12]) await createBooking(db, online(v, [v.tables[0]!], h, { customer: who }));
    expect(await code(createBooking(db, online(v, [v.tables[0]!], 13, { customer: who })))).toBe("limit");
  });
});

describe("venue payment ledger", () => {
  it("tracks partial and full payment separately from booking status and refuses overpayment", async () => {
    const v = await makeVenue(db);
    const { booking } = await createBooking(db, online(v, [v.tables[0]!], 14)); // ₹300
    const pay = (amount: number, kind: "collection" | "refund" = "collection") =>
      recordPayment(db, { businessId: v.businessId, bookingId: booking.id, kind, amount, method: "upi", actor: staff(v) });

    expect(await code(pay(10000))).toBe("validation"); // pending bookings take no payment
    await transitionBooking(db, { bookingId: booking.id, action: "approve", actor: staff(v), businessId: v.businessId });

    expect((await pay(10000)).booking.paymentStatus).toBe("partially_paid");
    expect(await code(pay(25000))).toBe("payment_exceeds_due");
    const full = await pay(20000);
    expect(full.booking.paymentStatus).toBe("paid");
    expect(full.booking.status).toBe("approved");
    expect(await code(pay(1))).toBe("payment_exceeds_due");

    const refunded = await pay(5000, "refund");
    expect(refunded.booking.amountCollected).toBe(25000);
    expect(refunded.booking.paymentStatus).toBe("partially_paid");
    expect(await code(pay(30000, "refund"))).toBe("payment_exceeds_due");
  });

  it("never collects more than is due under concurrent entries", async () => {
    const v = await makeVenue(db);
    const { booking } = await createBooking(db, { ...online(v, [v.tables[0]!], 14), source: "walk_in", actor: staff(v) });
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        code(recordPayment(db, { businessId: v.businessId, bookingId: booking.id, kind: "collection", amount: 20000, method: "cash", actor: staff(v) })),
      ),
    );
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row!.amountCollected).toBe(20000);
  });
});
