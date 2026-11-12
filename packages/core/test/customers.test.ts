import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { bookings, users, type Db } from "@krello/database";
import { closeTestDb, makeVenue, newPhone, testDb, type Venue } from "../../booking-engine/test/fixtures";
import {
  AppError,
  cancelOwnBooking,
  getCustomerBooking,
  listCustomerBookings,
  submitBookingRequest,
  updateProfile,
  viewCustomerBooking,
  type UserRow,
} from "../src";

process.env.SESSION_SECRET ??= "test-secret-at-least-16-chars";

let db: Db;
beforeAll(() => {
  db = testDb();
});
afterAll(closeTestDb);

async function newUser(name: string | null = null): Promise<UserRow> {
  const [u] = await db.insert(users).values({ phone: newPhone(), phoneVerifiedAt: new Date(), name }).returning();
  return u!;
}

/** Sends a request and returns the booking's id. */
async function book(v: Venue, user: UserRow, startHour: number): Promise<string> {
  const { reference } = await submitBookingRequest(db, {
    user,
    locationId: v.locationId,
    resourceIds: [v.tables[0]!],
    startsAt: v.at(startHour),
    endsAt: v.at(startHour + 1),
    groupSize: 2,
    name: "Asha Rao",
    idempotencyKey: randomUUID(),
  });
  const [row] = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.publicReference, reference));
  return row!.id;
}

describe("customer bookings", () => {
  it("lists only the user's own bookings, newest start first, across businesses", async () => {
    const [a, b] = [await makeVenue(db), await makeVenue(db)];
    const [asha, other] = [await newUser(), await newUser()];
    const early = await book(a, asha, 12);
    const late = await book(b, asha, 20);
    const middle = await book(a, asha, 16);
    const notMine = await book(b, other, 14);

    const listed = await listCustomerBookings(db, asha.id);
    expect(listed.map((x) => x.id)).toEqual([late, middle, early]);
    expect(listed.map((x) => x.id)).not.toContain(notMine);
    expect(new Set(listed.map((x) => x.businessSlug)).size).toBe(2);
    expect(listed.every((x) => x.status === "pending")).toBe(true);
    expect((await listCustomerBookings(db, other.id)).map((x) => x.id)).toEqual([notMine]);
  });

  it("returns null for a booking that belongs to someone else", async () => {
    const v = await makeVenue(db);
    const [owner, stranger] = [await newUser(), await newUser()];
    const id = await book(v, owner, 18);
    expect((await getCustomerBooking(db, owner.id, id))?.view.id).toBe(id);
    expect(await getCustomerBooking(db, stranger.id, id)).toBeNull();
  });

  it("refuses to cancel someone else's booking and leaves it untouched", async () => {
    const v = await makeVenue(db);
    const [owner, stranger] = [await newUser(), await newUser()];
    const id = await book(v, owner, 18);
    await expect(cancelOwnBooking(db, stranger.id, id)).rejects.toMatchObject({ name: "EngineError", code: "not_found" });
    expect((await getCustomerBooking(db, owner.id, id))!.view.status).toBe("pending");
  });
});

describe("viewCustomerBooking", () => {
  it("records an overdue request as expired and answers only for the owner", async () => {
    const v = await makeVenue(db);
    const [owner, stranger] = [await newUser(), await newUser()];
    const id = await book(v, owner, 18);
    await db.update(bookings).set({ pendingExpiresAt: new Date(Date.now() - 60_000) }).where(eq(bookings.id, id));

    expect(await viewCustomerBooking(db, stranger.id, id)).toBeNull();
    expect((await db.select().from(bookings).where(eq(bookings.id, id)))[0]!.status).toBe("pending");

    const found = await viewCustomerBooking(db, owner.id, id);
    expect(found!.view.status).toBe("expired");
    expect(found!.booking.status).toBe("expired");
  });
});

describe("updateProfile", () => {
  it("trims the name and stores it", async () => {
    const user = await newUser();
    const updated = await updateProfile(db, user.id, { name: "  Asha Rao " });
    expect(updated.name).toBe("Asha Rao");
    expect(updated.email).toBeNull();
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.name).toBe("Asha Rao");
  });

  it("stores a valid email trimmed and clears it when blank or null", async () => {
    const user = await newUser("Asha");
    expect((await updateProfile(db, user.id, { name: "Asha", email: " asha@example.com " })).email).toBe("asha@example.com");
    expect((await updateProfile(db, user.id, { name: "Asha", email: "   " })).email).toBeNull();
    await updateProfile(db, user.id, { name: "Asha", email: "asha@example.com" });
    expect((await updateProfile(db, user.id, { name: "Asha", email: null })).email).toBeNull();
  });

  it("rejects an empty name, a name over 80 characters and a malformed email", async () => {
    const user = await newUser("Before");
    for (const input of [{ name: "" }, { name: "   " }, { name: "x".repeat(81) }, { name: "Asha", email: "not-an-email" }]) {
      await expect(updateProfile(db, user.id, input)).rejects.toBeInstanceOf(AppError);
      await expect(updateProfile(db, user.id, input)).rejects.toMatchObject({ code: "validation", status: 400 });
    }
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.name).toBe("Before");
    expect(row!.email).toBeNull();
  });

  it("accepts an 80-character name", async () => {
    const user = await newUser();
    expect((await updateProfile(db, user.id, { name: "x".repeat(80) })).name).toHaveLength(80);
  });

  it("only changes name and email, and only for the given user", async () => {
    const [a, b] = [await newUser("A"), await newUser("B")];
    const updated = await updateProfile(db, a.id, { name: "Asha" });
    expect(updated.phone).toBe(a.phone);
    expect(updated.isSuperAdmin).toBe(false);
    expect((await db.select().from(users).where(eq(users.id, b.id)))[0]!.name).toBe("B");
  });

  it("is not found for an unknown user", async () => {
    await expect(updateProfile(db, randomUUID(), { name: "Asha" })).rejects.toMatchObject({ code: "not_found" });
  });
});
