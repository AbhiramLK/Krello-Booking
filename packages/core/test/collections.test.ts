import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { bookings, payments, type Db } from "@krello/database";
import { addDays, createBooking, EngineError, localToInstant, transitionBooking, type BookingRow } from "@krello/booking-engine";
import { closeTestDb, customer, staff as ownerActor, testDb, TZ } from "../../booking-engine/test/fixtures";
import {
  AppError,
  getBookingForTenant,
  getCollectionSummary,
  listCollections,
  listOutstandingBookings,
  parseRupees,
  recordCollection,
  type TenantContext,
} from "../src";
import { makeOtherBusiness, makeTeam, rejectsWith, type Team } from "./team";

process.env.SESSION_SECRET ??= "test-secret-at-least-16-chars";

let db: Db;
beforeAll(() => {
  db = testDb();
});
afterAll(closeTestDb);

let keySeq = 0;
const key = () => `test-key-${Date.now()}-${keySeq++}`;

/** Wide enough to hold every booking a test makes (a few days ahead) and every payment recorded now. */
const wide = () => ({ from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 10 * 86_400_000) });

/** A booking entered by the venue, so it starts approved. */
async function approved(t: Team, hour: number, opts: { locationId?: string; resourceId?: string } = {}): Promise<BookingRow> {
  const startsAt = t.v.at(hour);
  const { booking } = await createBooking(db, {
    locationId: opts.locationId ?? t.v.locationId,
    resourceIds: [opts.resourceId ?? t.v.tables[0]!],
    startsAt,
    endsAt: new Date(startsAt.getTime() + 60 * 60_000),
    groupSize: 2,
    customer: customer("Walk-in"),
    source: "phone",
    actor: ownerActor(t.v),
  });
  return booking;
}

const collect = (ctx: TenantContext, bookingId: string, amountRupees: string, method: "cash" | "upi" | "card" | "other" = "cash") =>
  recordCollection(db, ctx, { bookingId, kind: "collection", amountRupees, method, idempotencyKey: key() });

const refund = (ctx: TenantContext, bookingId: string, amountRupees: string, method: "cash" | "upi" | "card" | "other" = "cash") =>
  recordCollection(db, ctx, { bookingId, kind: "refund", amountRupees, method, idempotencyKey: key() });

describe("parsing rupees", () => {
  it("turns whole and fractional rupees into paise", () => {
    expect(parseRupees("150")).toBe(15000);
    expect(parseRupees("150.5")).toBe(15050);
    expect(parseRupees("150.50")).toBe(15050);
    expect(parseRupees(" 0.05 ")).toBe(5);
    expect(parseRupees("1")).toBe(100);
  });

  it.each(["0", "0.00", "-5", "1.234", "abc", "", "  ", "1e3", "12,50", "₹100", ".5", "5.", "1 000", "9999999999"])("rejects %j", (raw) => {
    expect(() => parseRupees(raw)).toThrowError(AppError);
    try {
      parseRupees(raw);
    } catch (e) {
      expect((e as AppError).code).toBe("validation");
    }
  });
});

describe("recording a collection", () => {
  it("lets staff record a collection, and moves the booking to partly paid then paid", async () => {
    const t = await makeTeam(db);
    const b = await approved(t, 11); // ₹300
    expect(b.totalAmount).toBe(30000);

    const part = await collect(t.staff, b.id, "100", "upi");
    expect(part.booking.amountCollected).toBe(10000);
    expect(part.booking.paymentStatus).toBe("partially_paid");
    expect(part.booking.status).toBe("approved");
    expect(part.payment.recordedBy).toBe(t.staff.user.id);

    const rest = await collect(t.staff, b.id, "200.00");
    expect(rest.booking.paymentStatus).toBe("paid");
    expect(rest.booking.amountCollected).toBe(30000);
  });

  it("keeps the optional reference and note, trimmed", async () => {
    const t = await makeTeam(db);
    const b = await approved(t, 11);
    const r = await recordCollection(db, t.staff, {
      bookingId: b.id,
      kind: "collection",
      amountRupees: "50",
      method: "upi",
      reference: "  UPI-9981 ",
      notes: " Paid by the host ",
      idempotencyKey: key(),
    });
    expect(r.payment.reference).toBe("UPI-9981");
    expect(r.payment.notes).toBe("Paid by the host");
  });

  it("rejects bad amounts with a validation error and records nothing", async () => {
    const t = await makeTeam(db);
    const b = await approved(t, 11);
    for (const bad of ["0", "-5", "1.234", "abc"]) {
      const err = await rejectsWith(collect(t.owner, b.id, bad), AppError, "validation");
      expect((err as AppError).status).toBe(422);
    }
    expect((await getBookingForTenant(db, t.owner, b.id))?.payments).toHaveLength(0);
  });

  it("rejects an unknown method, a bad kind and over-long text", async () => {
    const t = await makeTeam(db);
    const b = await approved(t, 11);
    const base = { bookingId: b.id, kind: "collection" as const, amountRupees: "10", method: "cash" as const, idempotencyKey: key() };
    await rejectsWith(recordCollection(db, t.owner, { ...base, method: "crypto" as never }), AppError, "validation");
    await rejectsWith(recordCollection(db, t.owner, { ...base, kind: "adjustment" as never }), AppError, "validation");
    await rejectsWith(recordCollection(db, t.owner, { ...base, reference: "x".repeat(101) }), AppError, "validation");
    await rejectsWith(recordCollection(db, t.owner, { ...base, notes: "x".repeat(501) }), AppError, "validation");
    await rejectsWith(recordCollection(db, t.owner, { ...base, idempotencyKey: "" }), AppError, "validation");
  });

  it("refuses to collect more than is still due", async () => {
    const t = await makeTeam(db);
    const b = await approved(t, 11); // ₹300
    await rejectsWith(collect(t.owner, b.id, "300.01"), EngineError, "payment_exceeds_due");
    await collect(t.owner, b.id, "250.50");
    const err = await rejectsWith(collect(t.owner, b.id, "50"), EngineError, "payment_exceeds_due");
    expect(err.message).toBe("Only ₹49.50 is still due on this booking.");
    await collect(t.owner, b.id, "49.50");
    await rejectsWith(collect(t.owner, b.id, "1"), EngineError, "payment_exceeds_due");
  });

  it("does not take a payment for a request that is still pending", async () => {
    const t = await makeTeam(db);
    const { booking } = await createBooking(db, {
      locationId: t.v.locationId,
      resourceIds: [t.v.tables[0]!],
      startsAt: t.v.at(12),
      endsAt: t.v.at(13),
      groupSize: 2,
      customer: customer(),
      source: "online",
      actor: { kind: "customer" },
    });
    await rejectsWith(collect(t.owner, booking.id, "10"), EngineError, "validation");
  });

  it("creates one payment row when the same idempotency key is used twice", async () => {
    const t = await makeTeam(db);
    const b = await approved(t, 11);
    const input = { bookingId: b.id, kind: "collection" as const, amountRupees: "100", method: "cash" as const, idempotencyKey: key() };
    const first = await recordCollection(db, t.staff, input);
    const again = await recordCollection(db, t.staff, input);
    expect(first.replayed).toBe(false);
    expect(again.replayed).toBe(true);
    expect(again.payment.id).toBe(first.payment.id);

    const rows = await db.select().from(payments).where(eq(payments.bookingId, b.id));
    expect(rows).toHaveLength(1);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(row?.amountCollected).toBe(10000);
  });

  it("does not let one booking's key stand in for another booking", async () => {
    const t = await makeTeam(db);
    const a = await approved(t, 11);
    const b = await approved(t, 12);
    const k = key();
    await recordCollection(db, t.owner, { bookingId: a.id, kind: "collection", amountRupees: "100", method: "cash", idempotencyKey: k });
    await rejectsWith(
      recordCollection(db, t.owner, { bookingId: b.id, kind: "collection", amountRupees: "100", method: "cash", idempotencyKey: k }),
      AppError,
      "validation",
    );
    const [row] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(row?.amountCollected).toBe(0);
  });

  it("lets two simultaneous collections through only up to the amount due", async () => {
    const t = await makeTeam(db);
    const b = await approved(t, 11); // ₹300
    const results = await Promise.allSettled([collect(t.owner, b.id, "200"), collect(t.manager, b.id, "200")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(row?.amountCollected).toBe(20000);
  });
});

describe("refunds", () => {
  it("lets an owner or manager refund, and rejects staff with forbidden", async () => {
    const t = await makeTeam(db);
    const b = await approved(t, 11);
    await collect(t.staff, b.id, "200");

    const err = await rejectsWith(refund(t.staff, b.id, "50"), AppError, "forbidden");
    expect((err as AppError).status).toBe(403);
    expect((await getBookingForTenant(db, t.owner, b.id))?.booking.amountCollected).toBe(20000);

    const a = await refund(t.manager, b.id, "50");
    expect(a.booking.amountCollected).toBe(15000);
    expect(a.booking.paymentStatus).toBe("partially_paid");
    const c = await refund(t.owner, b.id, "150");
    expect(c.booking.amountCollected).toBe(0);
    expect(c.booking.paymentStatus).toBe("unpaid");
  });

  it("refuses a refund larger than what was collected", async () => {
    const t = await makeTeam(db);
    const b = await approved(t, 11);
    await collect(t.owner, b.id, "100");
    await rejectsWith(refund(t.owner, b.id, "100.01"), EngineError, "payment_exceeds_due");
    expect((await getBookingForTenant(db, t.owner, b.id))?.booking.amountCollected).toBe(10000);
  });

  it("still refunds money taken on a booking that was cancelled afterwards", async () => {
    const t = await makeTeam(db);
    const b = await approved(t, 11);
    await collect(t.owner, b.id, "100");
    await transitionBooking(db, { bookingId: b.id, action: "cancel_by_business", actor: { kind: "business", userId: t.v.ownerId }, businessId: t.v.businessId, reason: "Closed" });
    const r = await refund(t.owner, b.id, "100");
    expect(r.booking.amountCollected).toBe(0);
  });
});

describe("tenant and location scope", () => {
  it("does not let another business record against or see a booking", async () => {
    const a = await makeTeam(db);
    const other = await makeOtherBusiness(db);
    const b = await approved(a, 11);
    await rejectsWith(collect(other, b.id, "10"), EngineError, "not_found");
    await rejectsWith(refund(other, b.id, "10"), EngineError, "not_found");
    await rejectsWith(collect(other, "not-a-uuid", "10"), EngineError, "not_found");
    expect((await getBookingForTenant(db, a.owner, b.id))?.payments).toHaveLength(0);
  });

  it("answers not-found, never forbidden, when staff try a booking at another location", async () => {
    const t = await makeTeam(db);
    const there = await approved(t, 11, { locationId: t.loc2, resourceId: t.loc2Table });
    await rejectsWith(collect(t.staff, there.id, "10"), EngineError, "not_found");
    // A refund by someone without the permission is forbidden whatever the booking.
    await rejectsWith(refund(t.staff, there.id, "10"), AppError, "forbidden");
    expect((await getBookingForTenant(db, t.owner, there.id))?.payments).toHaveLength(0);
  });

  it("shows B's context none of A's rows or figures", async () => {
    const a = await makeTeam(db);
    const other = await makeOtherBusiness(db);
    const b = await approved(a, 11);
    await collect(a.owner, b.id, "100", "upi");

    expect((await listCollections(db, a.owner, {})).total).toBe(1);
    const list = await listCollections(db, other, {});
    expect(list.total).toBe(0);
    expect(list.items).toEqual([]);
    // Even naming A's location does not reach it.
    expect((await listCollections(db, other, { locationId: a.v.locationId })).total).toBe(0);

    const summary = await getCollectionSummary(db, other, { ...wide(), locationId: a.v.locationId });
    expect(summary).toMatchObject({ bookingValue: 0, collected: 0, outstanding: 0, paidCount: 0, partlyPaidCount: 0, unpaidCount: 0, cancelledValue: 0 });
    expect((await listOutstandingBookings(db, other, wide())).items).toEqual([]);
  });

  it("limits staff to their assigned locations in the ledger, summary and outstanding list", async () => {
    const t = await makeTeam(db);
    const here = await approved(t, 11);
    const there = await approved(t, 11, { locationId: t.loc2, resourceId: t.loc2Table });
    await collect(t.owner, here.id, "100", "cash");
    await collect(t.owner, there.id, "200", "upi");

    const ledger = await listCollections(db, t.staff, {});
    expect(ledger.items.map((r) => r.bookingId)).toEqual([here.id]);
    expect((await listCollections(db, t.staff, { locationId: t.loc2 })).items).toEqual([]);
    expect((await listCollections(db, t.owner, {})).total).toBe(2);
    expect((await listCollections(db, t.owner, { locationId: t.loc2 })).items.map((r) => r.bookingId)).toEqual([there.id]);

    const staffSummary = await getCollectionSummary(db, t.staff, wide());
    expect(staffSummary).toMatchObject({ bookingValue: 30000, collected: 10000, outstanding: 20000 });
    expect(staffSummary.byMethod.upi).toBe(0);
    const staffThere = await getCollectionSummary(db, t.staff, { ...wide(), locationId: t.loc2 });
    expect(staffThere).toMatchObject({ bookingValue: 0, collected: 0, outstanding: 0 });
    const ownerSummary = await getCollectionSummary(db, t.owner, wide());
    expect(ownerSummary).toMatchObject({ bookingValue: 60000, collected: 30000, outstanding: 30000 });

    expect((await listOutstandingBookings(db, t.staff, wide())).items.map((b) => b.id)).toEqual([here.id]);
  });

  it("needs the payments permission to read the report", async () => {
    const t = await makeTeam(db);
    const noPayments = { ...t.staff, can: (p: string) => p !== "payments.record" && t.staff.can(p as never) } as TenantContext;
    await rejectsWith(listCollections(db, noPayments, {}), AppError, "forbidden");
    await rejectsWith(getCollectionSummary(db, noPayments, wide()), AppError, "forbidden");
    await rejectsWith(listOutstandingBookings(db, noPayments, wide()), AppError, "forbidden");
  });
});

describe("the collections report", () => {
  /** ₹300 approved paid ₹100 by UPI, ₹400 completed paid in full by cash, ₹500 cancelled. */
  async function scenario() {
    const t = await makeTeam(db);
    const partly = await approved(t, 11);
    expect(partly.totalAmount).toBe(30000);
    await collect(t.staff, partly.id, "100", "upi");

    const full = await approved(t, 18);
    expect(full.totalAmount).toBe(40000);
    await collect(t.staff, full.id, "400", "cash");
    await transitionBooking(db, {
      bookingId: full.id,
      action: "complete",
      actor: { kind: "business", userId: t.v.ownerId },
      businessId: t.v.businessId,
      now: new Date(full.endsAt.getTime() + 60_000),
    });

    const cancelled = await approved(t, 13);
    await transitionBooking(db, {
      bookingId: cancelled.id,
      action: "cancel_by_business",
      actor: { kind: "business", userId: t.v.ownerId },
      businessId: t.v.businessId,
      reason: "Closed",
    });
    // The seeded pricing cannot make a table cost exactly ₹500, so set the figure the scenario needs.
    await db.update(bookings).set({ totalAmount: 50000 }).where(eq(bookings.id, cancelled.id));
    return { t, partly, full, cancelled };
  }

  it("reports booking value, collected and outstanding apart, with cancelled bookings in none of them", async () => {
    const { t } = await scenario();
    const s = await getCollectionSummary(db, t.owner, wide());
    expect(s.bookingValue).toBe(70000);
    expect(s.collected).toBe(50000);
    expect(s.outstanding).toBe(20000);
    expect(s.byMethod).toEqual({ cash: 40000, upi: 10000, card: 0, other: 0 });
    expect(s.paidCount).toBe(1);
    expect(s.partlyPaidCount).toBe(1);
    expect(s.unpaidCount).toBe(0);
    expect(s.cancelledValue).toBe(50000);
  });

  it("takes a refund off collected and off its method", async () => {
    const { t, full } = await scenario();
    await refund(t.manager, full.id, "50", "cash");
    const s = await getCollectionSummary(db, t.owner, wide());
    expect(s.collected).toBe(45000);
    expect(s.byMethod.cash).toBe(35000);
    expect(s.byMethod.upi).toBe(10000);
    // The refunded booking is no longer fully paid, so more is outstanding.
    expect(s.outstanding).toBe(25000);
    expect(s.paidCount).toBe(0);
    expect(s.partlyPaidCount).toBe(2);
    expect(s.bookingValue).toBe(70000);
  });

  it("counts unpaid confirmed bookings, and leaves pending requests out of every figure", async () => {
    const t = await makeTeam(db);
    await approved(t, 11);
    await createBooking(db, {
      locationId: t.v.locationId,
      resourceIds: [t.v.tables[1]!],
      startsAt: t.v.at(12),
      endsAt: t.v.at(13),
      groupSize: 2,
      customer: customer(),
      source: "online",
      actor: { kind: "customer" },
    });
    const s = await getCollectionSummary(db, t.owner, wide());
    expect(s).toMatchObject({ bookingValue: 30000, collected: 0, outstanding: 30000, unpaidCount: 1, paidCount: 0, partlyPaidCount: 0, cancelledValue: 0 });
  });

  it("counts bookings by when they start and payments by when they were recorded", async () => {
    const { t } = await scenario();
    const dayBefore = { from: new Date(Date.now() - 3 * 86_400_000), to: new Date(Date.now() - 86_400_000) };
    expect(await getCollectionSummary(db, t.owner, dayBefore)).toMatchObject({ bookingValue: 0, collected: 0, outstanding: 0, cancelledValue: 0 });

    // Only the booking day: bookings are in range, but nothing was collected on that day yet.
    const onTheDay = { from: localToInstant(t.v.date, 0, TZ), to: localToInstant(addDays(t.v.date, 1), 0, TZ) };
    expect(await getCollectionSummary(db, t.owner, onTheDay)).toMatchObject({ bookingValue: 70000, collected: 0, outstanding: 20000, cancelledValue: 50000 });
    // Only recorded today: payments are in range, the bookings (three days ahead) are not.
    const today = { from: new Date(Date.now() - 3_600_000), to: new Date(Date.now() + 3_600_000) };
    expect(await getCollectionSummary(db, t.owner, today)).toMatchObject({ bookingValue: 0, collected: 50000, outstanding: 0 });
  });

  it("lists the ledger newest first with the booking, customer and who recorded it", async () => {
    const { t, partly, full } = await scenario();
    const list = await listCollections(db, t.owner, wide());
    expect(list.total).toBe(2);
    expect(list.items.map((r) => r.bookingId)).toEqual([full.id, partly.id]);
    expect(list.items[0]).toMatchObject({
      reference: full.publicReference,
      customerName: "Walk-in",
      kind: "collection",
      amount: 40000,
      method: "cash",
      recordedByName: "Staff",
      locationName: "Main",
    });
    expect(list.items[0]!.collectedAt).toBeInstanceOf(Date);
    expect(list.items[0]!.bookingId).toBe(full.id);
  });

  it("filters the ledger by method and range, and pages it", async () => {
    const { t } = await scenario();
    const upi = await listCollections(db, t.owner, { ...wide(), method: "upi" });
    expect(upi.items.map((r) => r.amount)).toEqual([10000]);
    expect((await listCollections(db, t.owner, { from: new Date(Date.now() + 3_600_000) })).total).toBe(0);

    const page1 = await listCollections(db, t.owner, { page: 1, pageSize: 1 });
    const page2 = await listCollections(db, t.owner, { page: 2, pageSize: 1 });
    expect(page1.total).toBe(2);
    expect(page1.items).toHaveLength(1);
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]!.id).not.toBe(page1.items[0]!.id);
  });

  it("lists confirmed bookings still owing money, soonest first, with the amount due", async () => {
    const { t, partly, full } = await scenario();
    const out = await listOutstandingBookings(db, t.owner, wide());
    expect(out.total).toBe(1);
    expect(out.items.map((b) => b.id)).toEqual([partly.id]);
    expect(out.items[0]).toMatchObject({ customerName: "Walk-in", totalAmount: 30000, amountCollected: 10000, due: 20000, status: "approved", paymentStatus: "partially_paid" });

    await refund(t.owner, full.id, "100");
    const after = await listOutstandingBookings(db, t.owner, wide());
    expect(after.items.map((b) => b.id)).toEqual([partly.id, full.id]);
  });
});
