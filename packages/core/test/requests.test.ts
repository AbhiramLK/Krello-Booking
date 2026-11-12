import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { bookings, users, type Db } from "@krello/database";
import {
  addInternalNote,
  createBooking,
  EngineError,
  getAvailability,
  transitionBooking,
} from "@krello/booking-engine";
import { closeTestDb, CUSTOMER, makeVenue, newPhone, staff, testDb, type Venue } from "../../booking-engine/test/fixtures";
import {
  AppError,
  cancelByToken,
  cancelOwnBooking,
  effectiveStatus,
  getBookingByToken,
  getCustomerBooking,
  listCustomerBookings,
  quoteBooking,
  submitBookingRequest,
  type UserRow,
} from "../src";

process.env.SESSION_SECRET ??= "test-secret-at-least-16-chars";

let db: Db;
beforeAll(() => {
  db = testDb();
});
afterAll(closeTestDb);

/** A fresh signed-up customer. Each test uses its own, so per-phone limits never collide. */
async function newUser(opts: { verified?: boolean; name?: string | null } = {}): Promise<UserRow> {
  const [u] = await db
    .insert(users)
    .values({ phone: newPhone(), phoneVerifiedAt: opts.verified === false ? null : new Date(), name: opts.name ?? null })
    .returning();
  return u!;
}

const request = (v: Venue, user: UserRow, over: Partial<Parameters<typeof submitBookingRequest>[1]> = {}) => ({
  user,
  locationId: v.locationId,
  resourceIds: [v.tables[0]!],
  startsAt: v.at(18),
  endsAt: v.at(20),
  groupSize: 2,
  name: "Asha Rao",
  idempotencyKey: randomUUID(),
  ...over,
});

const slotState = async (v: Venue, resourceId: string, hour: number) => {
  const a = await getAvailability(db, { locationId: v.locationId, date: v.date });
  const r = a.resources.find((x) => x.resourceId === resourceId)!;
  return r.slots.find((s) => s.startMinute === hour * 60)!.state;
};

describe("quoteBooking", () => {
  it("prices exactly what submitBookingRequest then books", async () => {
    const v = await makeVenue(db);
    const user = await newUser();
    // 16:00–18:00 crosses the evening peak at 17:00; the shared session is priced per person.
    const input = {
      locationId: v.locationId,
      resourceIds: [v.tables[0]!, v.session],
      startsAt: v.at(16),
      endsAt: v.at(18),
      groupSize: 3,
    };
    const quote = await quoteBooking(db, input);
    expect(quote.lines.map((l) => l.resourceId).sort()).toEqual([...input.resourceIds].sort());
    expect(quote.total).toBe(quote.lines.reduce((n, l) => n + l.amount, 0));
    // 300 + 400 for the table, 150 × 2 slots × 3 people for the session, in paise.
    expect(quote.total).toBe(30000 + 40000 + 15000 * 2 * 3);
    expect(quote.lines.find((l) => l.resourceId === v.tables[0])!.segments.length).toBe(2);

    const { reference } = await submitBookingRequest(db, { ...request(v, user), ...input });
    const [row] = await db.select().from(bookings).where(eq(bookings.publicReference, reference));
    expect(row!.totalAmount).toBe(quote.total);
  });

  it("refuses a time that is not made of whole slots, and a held slot", async () => {
    const v = await makeVenue(db);
    const base = { locationId: v.locationId, resourceIds: [v.tables[1]!], groupSize: 2 };
    await expect(quoteBooking(db, { ...base, startsAt: v.at(18, 30), endsAt: v.at(19, 30) })).rejects.toMatchObject({
      code: "validation",
    });
    await submitBookingRequest(db, request(v, await newUser(), { resourceIds: [v.tables[1]!] }));
    const err = await quoteBooking(db, { ...base, startsAt: v.at(18), endsAt: v.at(19) }).catch((e) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect(err.code).toBe("slot_conflict");
  });
});

describe("submitBookingRequest", () => {
  it("returns the same booking for two concurrent submissions with one idempotency key", async () => {
    const v = await makeVenue(db);
    const user = await newUser();
    const input = request(v, user);
    const [a, b] = await Promise.all([submitBookingRequest(db, input), submitBookingRequest(db, input)]);
    expect(a.reference).toBe(b.reference);
    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(bookings)
      .where(and(eq(bookings.businessId, v.businessId), eq(bookings.idempotencyKey, input.idempotencyKey)));
    expect(count!.n).toBe(1);
  });

  it("lets only one of two customers take the same slot", async () => {
    const v = await makeVenue(db);
    const results = await Promise.allSettled([
      submitBookingRequest(db, request(v, await newUser())),
      submitBookingRequest(db, request(v, await newUser())),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
    expect(failed.reason).toBeInstanceOf(EngineError);
    expect(failed.reason.code).toBe("slot_conflict");
  });

  it("rejects a user whose phone is not verified", async () => {
    const v = await makeVenue(db);
    const err = await submitBookingRequest(db, request(v, await newUser({ verified: false }))).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("phone_unverified");
  });

  it("books with the signed-in phone, and saves the name only when the user has none", async () => {
    const v = await makeVenue(db);
    const unnamed = await newUser();
    const { reference } = await submitBookingRequest(db, request(v, unnamed, { name: "  Meera  " }));
    const [row] = await db.select().from(bookings).where(eq(bookings.publicReference, reference));
    expect(row).toMatchObject({ customerPhone: unnamed.phone, customerUserId: unnamed.id, source: "online", status: "pending" });
    expect((await db.select().from(users).where(eq(users.id, unnamed.id)))[0]!.name).toBe("Meera");

    const named = await newUser({ name: "Ravi" });
    await submitBookingRequest(db, request(v, named, { name: "Someone Else", resourceIds: [v.tables[1]!] }));
    expect((await db.select().from(users).where(eq(users.id, named.id)))[0]!.name).toBe("Ravi");
  });

  it("allows 10 submissions per phone per hour", async () => {
    const v = await makeVenue(db);
    const user = await newUser();
    // Replays of one key still count, so this exercises the limit without the pending cap.
    const input = request(v, user);
    for (let i = 0; i < 10; i++) await submitBookingRequest(db, input);
    const err = await submitBookingRequest(db, input).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: "rate_limited", status: 429 });
  });
});

describe("effective status", () => {
  it("treats a pending request past its deadline as expired", () => {
    const now = new Date();
    expect(effectiveStatus({ status: "pending", pendingExpiresAt: new Date(now.getTime() - 1000) }, now)).toBe("expired");
    expect(effectiveStatus({ status: "pending", pendingExpiresAt: new Date(now.getTime() + 60_000) }, now)).toBe("pending");
    expect(effectiveStatus({ status: "approved", pendingExpiresAt: new Date(now.getTime() - 1000) }, now)).toBe("approved");
  });

  it("shows an overdue request as expired and not cancellable before any worker runs", async () => {
    const v = await makeVenue(db);
    const user = await newUser();
    const { statusToken, booking } = await createBooking(db, {
      locationId: v.locationId,
      resourceIds: [v.tables[2]!],
      startsAt: v.at(18),
      endsAt: v.at(19),
      customer: { name: "Late", phone: user.phone, userId: user.id },
      groupSize: 2,
      source: "online",
      actor: CUSTOMER,
    });
    const later = new Date(booking.pendingExpiresAt!.getTime() + 60_000);
    const found = await getBookingByToken(db, statusToken, later);
    expect(found!.booking.status).toBe("pending");
    expect(found!.view.status).toBe("expired");
    expect(found!.view.canCancel).toBe(false);

    expect((await getCustomerBooking(db, user.id, booking.id, later))!.view.status).toBe("expired");
    const listed = await listCustomerBookings(db, user.id, later);
    expect(listed.find((b) => b.id === booking.id)!.status).toBe("expired");
    expect((await getBookingByToken(db, statusToken))!.view.status).toBe("pending");
  });
});

describe("getBookingByToken", () => {
  it("returns null for a wrong, revoked or long-finished token", async () => {
    const v = await makeVenue(db);
    const { statusToken, booking } = await submitBookingRequest(db, request(v, await newUser())).then(async (r) => ({
      ...r,
      booking: (await db.select().from(bookings).where(eq(bookings.publicReference, r.reference)))[0]!,
    }));
    expect(await getBookingByToken(db, statusToken)).not.toBeNull();
    expect(await getBookingByToken(db, `${statusToken.slice(0, -2)}xx`)).toBeNull();
    expect(await getBookingByToken(db, statusToken, new Date(booking.endsAt.getTime() + 29 * 86_400_000))).not.toBeNull();
    expect(await getBookingByToken(db, statusToken, new Date(booking.endsAt.getTime() + 31 * 86_400_000))).toBeNull();

    await db.update(bookings).set({ statusTokenRevokedAt: new Date() }).where(eq(bookings.id, booking.id));
    expect(await getBookingByToken(db, statusToken)).toBeNull();
  });

  it("never exposes internal notes or the customer phone in the token view", async () => {
    const v = await makeVenue(db);
    const user = await newUser();
    const { statusToken, reference } = await submitBookingRequest(db, request(v, user, { notes: "Window seat please" }));
    const [row] = await db.select().from(bookings).where(eq(bookings.publicReference, reference));
    await addInternalNote(db, { bookingId: row!.id, businessId: v.businessId, note: "Secret staff remark", actor: staff(v) });

    const json = JSON.stringify((await getBookingByToken(db, statusToken))!.view);
    expect(json).not.toContain("Secret staff remark");
    expect(json).not.toContain(user.phone);
    expect(json).not.toContain(user.phone.replace(/^\+91/, ""));
  });
});

describe("cancelling", () => {
  it("cancels a pending request by token and frees the slot", async () => {
    const v = await makeVenue(db);
    const { statusToken } = await submitBookingRequest(db, request(v, await newUser()));
    expect(await slotState(v, v.tables[0]!, 18)).toBe("pending_hold");

    const view = await cancelByToken(db, statusToken, "Plans changed");
    expect(view.status).toBe("cancelled_by_customer");
    expect(view.cancellationReason).toBe("Plans changed");
    expect(view.canCancel).toBe(false);
    expect(await slotState(v, v.tables[0]!, 18)).toBe("available");
  });

  it("refuses to cancel an approved booking once the deadline has passed", async () => {
    // A 30-day deadline means every slot in the test window is already past it.
    const v = await makeVenue(db, { policy: { cancellationDeadlineMinutes: 30 * 24 * 60 } });
    const { statusToken, reference } = await submitBookingRequest(db, request(v, await newUser()));
    const [row] = await db.select().from(bookings).where(eq(bookings.publicReference, reference));
    await transitionBooking(db, { bookingId: row!.id, action: "approve", actor: staff(v) });

    const err = await cancelByToken(db, statusToken).catch((e) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect(err.code).toBe("policy");
  });

  it("lets a customer cancel only their own booking", async () => {
    const v = await makeVenue(db);
    const owner = await newUser();
    const { reference } = await submitBookingRequest(db, request(v, owner));
    const [row] = await db.select().from(bookings).where(eq(bookings.publicReference, reference));

    const stranger = await newUser();
    await expect(cancelOwnBooking(db, stranger.id, row!.id)).rejects.toMatchObject({ code: "not_found" });
    const view = await cancelOwnBooking(db, owner.id, row!.id);
    expect(view.status).toBe("cancelled_by_customer");
  });
});
