import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, bookings, resourceBlocks, subscriptions, type Db } from "@krello/database";
import { addDays, createBooking, EngineError, getAvailability, transitionBooking } from "@krello/booking-engine";
import { closeTestDb, CUSTOMER, customer, staff as ownerActor, testDb, TZ } from "../../booking-engine/test/fixtures";
import {
  AppError,
  blockResource,
  createManualBooking,
  getCalendarDay,
  getCalendarWeek,
  quoteBooking,
  quoteManualBooking,
  unblockResource,
} from "../src";
import { makeOtherBusiness, makeTeam, rejectsWith } from "./team";

process.env.SESSION_SECRET ??= "test-secret-at-least-16-chars";

let db: Db;
beforeAll(() => {
  db = testDb();
});
afterAll(closeTestDb);

let keySeq = 0;
const key = () => `00000000-0000-4000-8000-${String(Date.now() % 1e8).padStart(8, "0")}${String(keySeq++).padStart(4, "0")}`;

const hour = 60 * 60_000;

describe("manual bookings", () => {
  it("enters a walk-in as approved, created by the staff member, and takes the slot", async () => {
    const t = await makeTeam(db);
    const { v } = t;
    const out = await createManualBooking(db, t.staff, {
      locationId: v.locationId,
      resourceIds: [v.tables[0]!],
      startsAt: v.at(14),
      endsAt: v.at(15),
      source: "walk_in",
      name: "Ravi",
      groupSize: 2,
      idempotencyKey: key(),
    });
    expect(out.booking.status).toBe("approved");
    expect(out.booking.source).toBe("walk_in");
    expect(out.booking.createdBy).toBe(t.staff.user.id);
    expect(out.booking.totalAmount).toBe(30000);

    const customerView = await getAvailability(db, { locationId: v.locationId, date: v.date, audience: "customer" });
    const slot = customerView.resources.find((r) => r.resourceId === v.tables[0])!.slots.find((s) => s.startMinute === 14 * 60)!;
    expect(slot.state).toBe("confirmed");
  });

  it("refuses a slot held by an online request, with the engine's message", async () => {
    const t = await makeTeam(db);
    const { v } = t;
    await createBooking(db, {
      locationId: v.locationId,
      resourceIds: [v.tables[0]!],
      startsAt: v.at(18),
      endsAt: v.at(19),
      groupSize: 2,
      customer: customer(),
      source: "online",
      actor: CUSTOMER,
    });
    const e = await rejectsWith(
      createManualBooking(db, t.manager, {
        locationId: v.locationId,
        resourceIds: [v.tables[0]!],
        startsAt: v.at(18),
        endsAt: v.at(19),
        source: "phone",
        name: "Meera",
        groupSize: 2,
        idempotencyKey: key(),
      }),
      EngineError,
      "slot_conflict",
    );
    expect(e.message).toContain("Table 1");
  });

  it("refuses the online source: manual entry is for phone, walk-in and venue bookings", async () => {
    const t = await makeTeam(db);
    const { v } = t;
    const e = await rejectsWith(
      createManualBooking(db, t.owner, {
        locationId: v.locationId,
        resourceIds: [v.tables[0]!],
        startsAt: v.at(14),
        endsAt: v.at(15),
        source: "online" as never,
        name: "Sneaky",
        phone: "9876543210",
        groupSize: 2,
        idempotencyKey: key(),
      }),
      AppError,
      "validation",
    );
    expect((e as AppError).status).toBe(422);
    expect(await db.select().from(bookings).where(eq(bookings.locationId, v.locationId))).toEqual([]);
  });

  it("repeats a submission with the same key without booking twice", async () => {
    const t = await makeTeam(db);
    const { v } = t;
    const input = {
      locationId: v.locationId,
      resourceIds: [v.tables[1]!],
      startsAt: v.at(12),
      endsAt: v.at(13),
      source: "phone" as const,
      name: "Asha",
      groupSize: 2,
      idempotencyKey: key(),
    };
    const first = await createManualBooking(db, t.staff, input);
    const second = await createManualBooking(db, t.staff, input);
    expect(second.booking.id).toBe(first.booking.id);
    expect(second.replayed).toBe(true);
  });

  it("names a blank walk-in 'Walk-in' but still asks for a name on phone bookings", async () => {
    const t = await makeTeam(db);
    const { v } = t;
    const base = { locationId: v.locationId, resourceIds: [v.tables[0]!], source: "walk_in" as const, name: "  ", groupSize: 2 };
    const walkIn = await createManualBooking(db, t.staff, { ...base, startsAt: v.at(11), endsAt: v.at(12), idempotencyKey: key() });
    expect(walkIn.booking.customerName).toBe("Walk-in");
    await rejectsWith(
      createManualBooking(db, t.staff, { ...base, source: "phone", startsAt: v.at(13), endsAt: v.at(14), idempotencyKey: key() }),
      EngineError,
      "validation",
    );
  });

  it("stores a normalised phone number and refuses one that is not a mobile number", async () => {
    const t = await makeTeam(db);
    const { v } = t;
    const base = { locationId: v.locationId, resourceIds: [v.tables[0]!], source: "phone" as const, name: "Kiran", groupSize: 2 };
    const ok = await createManualBooking(db, t.staff, { ...base, phone: "098765 43210", startsAt: v.at(11), endsAt: v.at(12), idempotencyKey: key() });
    expect(ok.booking.customerPhone).toBe("+919876543210");
    const e = await rejectsWith(
      createManualBooking(db, t.staff, { ...base, phone: "12345", startsAt: v.at(13), endsAt: v.at(14), idempotencyKey: key() }),
      AppError,
      "invalid_phone",
    );
    expect((e as AppError).status).toBe(422);
    // A blank phone is simply not given.
    const none = await createManualBooking(db, t.staff, { ...base, phone: "  ", startsAt: v.at(15), endsAt: v.at(16), idempotencyKey: key() });
    expect(none.booking.customerPhone).toBeNull();
  });

  it("books consecutive slots as one booking and prices them together", async () => {
    const t = await makeTeam(db);
    const { v } = t;
    // 16:00 is off-peak (₹300), 17:00 and 18:00 are the evening peak (₹400).
    const input = { locationId: v.locationId, resourceIds: [v.tables[2]!], startsAt: v.at(16), endsAt: v.at(19), groupSize: 2 };
    const quote = await quoteManualBooking(db, t.staff, input);
    expect(quote.total).toBe(110000);
    const out = await createManualBooking(db, t.staff, { ...input, source: "phone", name: "Dev", idempotencyKey: key() });
    expect(out.booking.totalAmount).toBe(quote.total);
  });

  it("is refused while the subscription has expired", async () => {
    const t = await makeTeam(db);
    const { v } = t;
    await db.update(subscriptions).set({ status: "expired" }).where(eq(subscriptions.businessId, v.businessId));
    await rejectsWith(
      createManualBooking(db, t.owner, {
        locationId: v.locationId,
        resourceIds: [v.tables[0]!],
        startsAt: v.at(14),
        endsAt: v.at(15),
        source: "phone",
        name: "Late",
        groupSize: 2,
        idempotencyKey: key(),
      }),
      EngineError,
      "read_only",
    );
    // The calendar itself still reads.
    expect((await getCalendarDay(db, t.owner, { locationId: v.locationId, date: v.date })).resources.length).toBeGreaterThan(0);
  });
});

describe("quote for staff", () => {
  it("prices a slot even when the venue is not taking online bookings", async () => {
    const t = await makeTeam(db);
    const { v } = t;
    // Customers cannot book online now, and the quote path for them refuses; staff can still price a booking.
    await db.update(subscriptions).set({ status: "expired" }).where(eq(subscriptions.businessId, v.businessId));
    await rejectsWith(
      quoteBooking(db, { locationId: v.locationId, resourceIds: [v.session], startsAt: v.at(11), endsAt: v.at(12), groupSize: 4 }),
      EngineError,
      "not_bookable",
    );
    const q = await quoteManualBooking(db, t.staff, { locationId: v.locationId, resourceIds: [v.session], startsAt: v.at(11), endsAt: v.at(12), groupSize: 4 });
    // ₹150 per person per slot.
    expect(q.total).toBe(60000);
    expect(q.lines.map((l) => l.name)).toEqual(["Open swim"]);
  });

  it("explains a slot that is not free", async () => {
    const t = await makeTeam(db);
    const { v } = t;
    await blockResource(db, t.manager, { resourceId: v.tables[0]!, startsAt: v.at(11), endsAt: v.at(12) });
    await rejectsWith(
      quoteManualBooking(db, t.staff, { locationId: v.locationId, resourceIds: [v.tables[0]!], startsAt: v.at(11), endsAt: v.at(12), groupSize: 2 }),
      EngineError,
      "slot_conflict",
    );
  });
});

describe("blocks", () => {
  it("lets a manager block 10:00-12:00, shows it on the calendar and frees it when removed", async () => {
    const t = await makeTeam(db);
    const { v } = t;
    const block = await blockResource(db, t.manager, { resourceId: v.tables[0]!, startsAt: v.at(10), endsAt: v.at(12), reason: "Cloth change" });

    const day = await getCalendarDay(db, t.manager, { locationId: v.locationId, date: v.date });
    expect(day.timezone).toBe(TZ);
    expect(day.blocks).toEqual([
      { id: block.id, resourceId: v.tables[0], startsAt: v.at(10), endsAt: v.at(12), reason: "Cloth change" },
    ]);
    const states = day.resources.find((r) => r.id === v.tables[0])!.slots.filter((s) => s.startMinute < 13 * 60).map((s) => [s.startMinute, s.state]);
    expect(states).toEqual([
      [10 * 60, "blocked"],
      [11 * 60, "blocked"],
      [12 * 60, "available"],
    ]);

    await unblockResource(db, t.manager, block.id);
    const after = await getCalendarDay(db, t.manager, { locationId: v.locationId, date: v.date });
    expect(after.blocks).toEqual([]);
    expect(after.resources.find((r) => r.id === v.tables[0])!.slots.find((s) => s.startMinute === 10 * 60)!.state).toBe("available");
  });

  it("is for owners and managers: staff can add bookings but not blocks", async () => {
    const t = await makeTeam(db);
    const { v } = t;
    await createManualBooking(db, t.staff, {
      locationId: v.locationId,
      resourceIds: [v.tables[0]!],
      startsAt: v.at(14),
      endsAt: v.at(15),
      source: "walk_in",
      name: "",
      groupSize: 1,
      idempotencyKey: key(),
    });
    const e = await rejectsWith(blockResource(db, t.staff, { resourceId: v.tables[1]!, startsAt: v.at(10), endsAt: v.at(11) }), AppError, "forbidden");
    expect((e as AppError).status).toBe(403);

    const block = await blockResource(db, t.owner, { resourceId: v.tables[1]!, startsAt: v.at(10), endsAt: v.at(11) });
    await rejectsWith(unblockResource(db, t.staff, block.id), AppError, "forbidden");
    const [row] = await db.select().from(resourceBlocks).where(eq(resourceBlocks.id, block.id));
    expect(row!.removedAt).toBeNull();
  });

  it("refuses a block over live bookings and says how many", async () => {
    const t = await makeTeam(db);
    const { v } = t;
    await createManualBooking(db, t.owner, {
      locationId: v.locationId,
      resourceIds: [v.tables[0]!],
      startsAt: v.at(11),
      endsAt: v.at(12),
      source: "phone",
      name: "Anil",
      groupSize: 2,
      idempotencyKey: key(),
    });
    const e = await rejectsWith(blockResource(db, t.manager, { resourceId: v.tables[0]!, startsAt: v.at(10), endsAt: v.at(13) }), EngineError, "slot_conflict");
    expect(e.message).toMatch(/1 booking overlap/);
  });

  it("checks the member's locations for a resource or block, even when the role may manage blocks", async () => {
    const t = await makeTeam(db);
    // Even the permission-holding manager is checked per location; the restricted staff member never gets this far.
    const restrictedManager = { ...t.manager, canAccessLocation: (id: string) => id === t.v.locationId };
    await rejectsWith(blockResource(db, restrictedManager, { resourceId: t.loc2Table, startsAt: t.v.at(10), endsAt: t.v.at(11) }), EngineError, "not_found");
    const block = await blockResource(db, t.manager, { resourceId: t.loc2Table, startsAt: t.v.at(10), endsAt: t.v.at(11) });
    await rejectsWith(unblockResource(db, restrictedManager, block.id), EngineError, "not_found");
    await unblockResource(db, t.manager, block.id);
  });

  it("records who blocked and who unblocked", async () => {
    const t = await makeTeam(db);
    const block = await blockResource(db, t.manager, { resourceId: t.v.tables[2]!, startsAt: t.v.at(10), endsAt: t.v.at(11), reason: "  " });
    expect(block.createdBy).toBe(t.manager.user.id);
    expect(block.reason).toBeNull();
    await unblockResource(db, t.manager, block.id);
    const entries = await db.select({ action: auditLogs.action, actor: auditLogs.actorUserId }).from(auditLogs).where(eq(auditLogs.targetId, block.id));
    expect(entries.map((e) => e.action).sort()).toEqual(["block.created", "block.removed"]);
    expect(entries.every((e) => e.actor === t.manager.user.id)).toBe(true);
  });
});

describe("tenant scope", () => {
  it("does not open, book into or block another business's location", async () => {
    const a = await makeTeam(db);
    const other = await makeOtherBusiness(db);
    const { v } = a;

    await rejectsWith(getCalendarDay(db, other, { locationId: v.locationId, date: v.date }), EngineError, "not_found");
    await rejectsWith(getCalendarWeek(db, other, { locationId: v.locationId, from: v.date }), EngineError, "not_found");
    await rejectsWith(
      createManualBooking(db, other, {
        locationId: v.locationId,
        resourceIds: [v.tables[0]!],
        startsAt: v.at(14),
        endsAt: v.at(15),
        source: "phone",
        name: "Intruder",
        groupSize: 2,
        idempotencyKey: key(),
      }),
      EngineError,
      "not_found",
    );
    await rejectsWith(
      quoteManualBooking(db, other, { locationId: v.locationId, resourceIds: [v.tables[0]!], startsAt: v.at(14), endsAt: v.at(15), groupSize: 2 }),
      EngineError,
      "not_found",
    );
    await rejectsWith(blockResource(db, other, { resourceId: v.tables[0]!, startsAt: v.at(10), endsAt: v.at(11) }), EngineError, "not_found");

    const block = await blockResource(db, a.owner, { resourceId: v.tables[0]!, startsAt: v.at(10), endsAt: v.at(11) });
    await rejectsWith(unblockResource(db, other, block.id), EngineError, "not_found");
    await rejectsWith(unblockResource(db, a.owner, "not-a-uuid"), EngineError, "not_found");
    const booked = await db.select().from(bookings).where(eq(bookings.locationId, v.locationId));
    expect(booked).toEqual([]);
  });

  it("will not take a resource from one location into a booking for another", async () => {
    const t = await makeTeam(db);
    await rejectsWith(
      createManualBooking(db, t.owner, {
        locationId: t.v.locationId,
        resourceIds: [t.loc2Table],
        startsAt: t.v.at(14),
        endsAt: t.v.at(15),
        source: "phone",
        name: "Mixed",
        groupSize: 2,
        idempotencyKey: key(),
      }),
      EngineError,
      "validation",
    );
  });

  it("gives a staff member only the locations they are assigned to", async () => {
    const t = await makeTeam(db);
    await rejectsWith(getCalendarDay(db, t.staff, { locationId: t.loc2, date: t.v.date }), EngineError, "not_found");
    await rejectsWith(getCalendarWeek(db, t.staff, { locationId: t.loc2, from: t.v.date }), EngineError, "not_found");
    await rejectsWith(
      createManualBooking(db, t.staff, {
        locationId: t.loc2,
        resourceIds: [t.loc2Table],
        startsAt: t.v.at(14),
        endsAt: t.v.at(15),
        source: "walk_in",
        name: "",
        groupSize: 1,
        idempotencyKey: key(),
      }),
      EngineError,
      "not_found",
    );
    expect((await getCalendarDay(db, t.staff, { locationId: t.v.locationId, date: t.v.date })).resources.length).toBe(4);
    expect((await getCalendarDay(db, t.owner, { locationId: t.loc2, date: t.v.date })).resources.map((r) => r.id)).toEqual([t.loc2Table]);
  });

  it("rejects dates and ids that are not well formed", async () => {
    const t = await makeTeam(db);
    await rejectsWith(getCalendarDay(db, t.owner, { locationId: t.v.locationId, date: "2026-13-40" }), EngineError, "validation");
    await rejectsWith(getCalendarDay(db, t.owner, { locationId: "nope", date: t.v.date }), EngineError, "not_found");
    await rejectsWith(getCalendarWeek(db, t.owner, { locationId: t.v.locationId, from: "tomorrow" }), EngineError, "validation");
  });
});

describe("getCalendarDay", () => {
  it("lists live bookings with phone, items, places and total, and none that were released", async () => {
    const t = await makeTeam(db);
    const { v } = t;
    const phone = await createManualBooking(db, t.staff, {
      locationId: v.locationId,
      resourceIds: [v.tables[0]!, v.tables[1]!],
      startsAt: v.at(14),
      endsAt: v.at(15),
      source: "phone",
      name: "Both tables",
      phone: "9876543210",
      groupSize: 6,
      idempotencyKey: key(),
    });
    const swim = await createManualBooking(db, t.staff, {
      locationId: v.locationId,
      resourceIds: [v.session],
      startsAt: v.at(14),
      endsAt: v.at(15),
      source: "walk_in",
      name: "Swimmer",
      groupSize: 3,
      idempotencyKey: key(),
    });
    const cancelled = await createManualBooking(db, t.staff, {
      locationId: v.locationId,
      resourceIds: [v.tables[2]!],
      startsAt: v.at(14),
      endsAt: v.at(15),
      source: "phone",
      name: "Gone",
      groupSize: 2,
      idempotencyKey: key(),
    });
    await transitionBooking(db, { bookingId: cancelled.booking.id, action: "cancel_by_business", actor: ownerActor(v), reason: "Test" });
    const online = await createBooking(db, {
      locationId: v.locationId,
      resourceIds: [v.tables[2]!],
      startsAt: v.at(16),
      endsAt: v.at(17),
      groupSize: 2,
      customer: customer("Online"),
      source: "online",
      actor: CUSTOMER,
    });

    const day = await getCalendarDay(db, t.staff, { locationId: v.locationId, date: v.date });
    const ids = day.bookings.map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining([phone.booking.id, swim.booking.id, online.booking.id]));
    expect(ids).not.toContain(cancelled.booking.id);

    const both = day.bookings.find((b) => b.id === phone.booking.id)!;
    expect(both.resourceIds.sort()).toEqual([v.tables[0], v.tables[1]].sort());
    expect(both.customerName).toBe("Both tables");
    expect(both.customerPhone).toBe("+919876543210");
    expect(both.source).toBe("phone");
    expect(both.status).toBe("approved");
    expect(both.paymentStatus).toBe("unpaid");
    expect(both.groupSize).toBe(6);
    expect(both.totalAmount).toBe(60000);
    expect(both.items.map((i) => i.name).sort()).toEqual(["Table 1", "Table 2"]);

    const shared = day.bookings.find((b) => b.id === swim.booking.id)!;
    expect(shared.items).toEqual([{ resourceId: v.session, name: "Open swim", units: 3 }]);
    expect(day.bookings.find((b) => b.id === online.booking.id)!.status).toBe("pending");
  });

  it("reports a request past its deadline as expired while it still holds the slot", async () => {
    const t = await makeTeam(db);
    const { v } = t;
    const placed = await createBooking(db, {
      locationId: v.locationId,
      resourceIds: [v.tables[0]!],
      startsAt: v.at(18),
      endsAt: v.at(19),
      groupSize: 2,
      customer: customer(),
      source: "online",
      actor: CUSTOMER,
    });
    const deadline = placed.booking.pendingExpiresAt!;
    const status = async (now: Date) =>
      (await getCalendarDay(db, t.owner, { locationId: v.locationId, date: v.date }, { now })).bookings.find((b) => b.id === placed.booking.id)?.status;
    expect(await status(new Date(deadline.getTime() - 60_000))).toBe("pending");
    // The expiry job has not run, so the booking is still listed, but it no longer reads as awaiting an answer.
    expect(await status(new Date(deadline.getTime() + 60_000))).toBe("expired");
  });

  it("keeps completed and no-show bookings on the day", async () => {
    const t = await makeTeam(db);
    const { v } = t;
    // Yesterday, so the visit has really happened and attendance can be recorded.
    const date = addDays(v.date, -4);
    const at = (h: number) => new Date(v.at(h).getTime() - 4 * 24 * hour);
    const a = await createBooking(db, {
      locationId: v.locationId,
      resourceIds: [v.tables[0]!],
      startsAt: at(10),
      endsAt: at(11),
      groupSize: 2,
      customer: customer("Came"),
      source: "phone",
      actor: ownerActor(v),
      now: new Date(at(10).getTime() - 5 * 24 * hour),
    });
    const b = await createBooking(db, {
      locationId: v.locationId,
      resourceIds: [v.tables[1]!],
      startsAt: at(10),
      endsAt: at(11),
      groupSize: 2,
      customer: customer("Did not"),
      source: "phone",
      actor: ownerActor(v),
      now: new Date(at(10).getTime() - 5 * 24 * hour),
    });
    await transitionBooking(db, { bookingId: a.booking.id, action: "complete", actor: ownerActor(v) });
    await transitionBooking(db, { bookingId: b.booking.id, action: "no_show", actor: ownerActor(v) });

    const day = await getCalendarDay(db, t.owner, { locationId: v.locationId, date });
    const byId = new Map(day.bookings.map((x) => [x.id, x.status]));
    expect(byId.get(a.booking.id)).toBe("completed");
    expect(byId.get(b.booking.id)).toBe("no_show");
  });

  it("shows only the day asked for, though the engine loads 36 hours", async () => {
    const t = await makeTeam(db);
    const { v } = t;
    // A late-night block belongs to tomorrow's calendar, not today's.
    const tomorrow = addDays(v.date, 1);
    await blockResource(db, t.owner, {
      resourceId: v.tables[0]!,
      startsAt: new Date(v.at(10).getTime() + 24 * hour),
      endsAt: new Date(v.at(12).getTime() + 24 * hour),
      reason: "Tomorrow",
    });
    expect((await getCalendarDay(db, t.owner, { locationId: v.locationId, date: v.date })).blocks).toEqual([]);
    expect((await getCalendarDay(db, t.owner, { locationId: v.locationId, date: tomorrow })).blocks.map((b) => b.reason)).toEqual(["Tomorrow"]);
  });
});

describe("getCalendarWeek", () => {
  it("returns seven days with booked and available minutes", async () => {
    const t = await makeTeam(db);
    const { v } = t;
    await createManualBooking(db, t.staff, {
      locationId: v.locationId,
      resourceIds: [v.tables[0]!],
      startsAt: v.at(14),
      endsAt: v.at(15),
      source: "phone",
      name: "Hour",
      groupSize: 2,
      idempotencyKey: key(),
    });
    const week = await getCalendarWeek(db, t.staff, { locationId: v.locationId, from: addDays(v.date, -2) });
    expect(week).toHaveLength(7);
    expect(week.map((d) => d.date)).toEqual([-2, -1, 0, 1, 2, 3, 4].map((n) => addDays(v.date, n)));

    const day = week.find((d) => d.date === v.date)!;
    expect(day.bookedMinutes).toBe(60);
    expect(day.confirmed).toBe(1);
    expect(day.pending).toBe(0);
    // Three tables and a swim session, each open 10:00-22:00.
    expect(day.availableMinutes).toBe(4 * 12 * 60);
    expect(week.filter((d) => d.date !== v.date).every((d) => d.bookedMinutes === 0 && d.confirmed === 0)).toBe(true);
  });

  it("counts live requests as pending, shared places by share, and takes blocked time off what is available", async () => {
    const t = await makeTeam(db);
    const { v } = t;
    await createBooking(db, {
      locationId: v.locationId,
      resourceIds: [v.tables[0]!],
      startsAt: v.at(18),
      endsAt: v.at(19),
      groupSize: 2,
      customer: customer(),
      source: "online",
      actor: CUSTOMER,
    });
    await createManualBooking(db, t.staff, {
      locationId: v.locationId,
      resourceIds: [v.session],
      startsAt: v.at(11),
      endsAt: v.at(12),
      source: "walk_in",
      name: "",
      groupSize: 5,
      idempotencyKey: key(),
    });
    await blockResource(db, t.owner, { resourceId: v.tables[1]!, startsAt: v.at(10), endsAt: v.at(12) });

    const [day] = await getCalendarWeek(db, t.owner, { locationId: v.locationId, from: v.date });
    expect(day!.date).toBe(v.date);
    expect(day!.pending).toBe(1);
    expect(day!.confirmed).toBe(1);
    // Five of the ten swim places for an hour is half an hour of the session. The request only holds its table, so it is not booked time yet.
    expect(day!.bookedMinutes).toBe(30);
    expect(day!.availableMinutes).toBe(4 * 12 * 60 - 120);
  });
});
