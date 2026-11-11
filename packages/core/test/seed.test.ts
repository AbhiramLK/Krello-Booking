import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getAvailability } from "@krello/booking-engine";
import { testDb } from "../../booking-engine/test/fixtures";
import { searchBusinesses } from "../src";
import { seedDemo, type SeedSummary } from "../../../scripts/seed";

// A Tuesday, 11:00 in Bengaluru. Tomorrow (Wednesday) is an ordinary weekday, so
// the base and evening prices both apply to it.
const NOW = new Date("2026-11-10T05:30:00Z");
const TOMORROW = "2026-11-11";

const db = testDb();
let summary: SeedSummary;

describe("demo seed", () => {
  beforeAll(async () => {
    summary = await seedDemo(db, { now: NOW });
  }, 240_000);

  it("creates three venues with a realistic amount of history", () => {
    expect(summary.businesses).toBe(3);
    expect(summary.bookings).toBeGreaterThan(300);
    expect(summary.payments).toBeGreaterThan(150);
    expect(summary.reviews).toBeGreaterThan(30);
  });

  it("lists the demo logins", () => {
    expect(summary.logins.map((l) => l.phone)).toEqual(
      expect.arrayContaining([
        "+919000000001",
        "+919000000011",
        "+919000000012",
        "+919000000013",
        "+919000000021",
        "+919000000031",
        "+919000000091",
      ]),
    );
    expect(summary.logins.find((l) => l.phone === "+919000000031")).toMatchObject({ role: "staff", business: "cue-masters" });
  });

  it("is found by the marketplace search", async () => {
    const all = await searchBusinesses(db, {});
    expect(all.items.map((b) => b.slug).sort()).toEqual(["bluelane-aquatics", "cue-masters", "respawn-lounge"]);

    const swim = await searchBusinesses(db, { category: "swimming" });
    expect(swim.items.map((b) => b.slug)).toEqual(["bluelane-aquatics"]);

    const ps = await searchBusinesses(db, { q: "playstation" });
    expect(ps.items.map((b) => b.slug)).toEqual(["respawn-lounge"]);
  });

  it("prices Table 1 by time of day on a weekday", async () => {
    const [loc] = await db.execute<{ id: string }>(
      sql`select l.id from locations l join businesses b on b.id = l.business_id
          where b.slug = 'cue-masters' and l.locality = 'Indiranagar'`,
    );
    const day = await getAvailability(db, { locationId: loc!.id, date: TOMORROW, now: NOW });
    expect(day.resources).toHaveLength(6);
    const table1 = day.resources.find((r) => r.name === "Table 1")!;
    const open = table1.slots.filter((s) => s.state === "available");
    expect(open.some((s) => s.price === 20000)).toBe(true);
    expect(open.some((s) => s.price === 30000)).toBe(true);
  });

  it("never double-books an exclusive resource", async () => {
    const [row] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n
      from booking_allocations a
      join booking_allocations b
        on a.resource_id = b.resource_id and a.id < b.id
       and a.starts_at < b.ends_at and b.starts_at < a.ends_at
      where a.is_exclusive and b.is_exclusive
        and a.allocation_status in ('held', 'confirmed') and b.allocation_status in ('held', 'confirmed')`);
    expect(row!.n).toBe(0);
  });

  it("keeps collections within booking totals", async () => {
    const [sums] = await db.execute<{ collected: string; total: string }>(
      sql`select coalesce(sum(amount_collected), 0) as collected, coalesce(sum(total_amount), 0) as total from bookings`,
    );
    expect(Number(sums!.collected)).toBeLessThanOrEqual(Number(sums!.total));
    expect(Number(sums!.collected)).toBeGreaterThan(0);

    const [bad] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from bookings where payment_status = 'paid' and amount_collected <> total_amount`,
    );
    expect(bad!.n).toBe(0);

    const [ledger] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from bookings b
      where b.amount_collected <> coalesce((select sum(case when p.kind = 'collection' then p.amount else -p.amount end)
                                            from payments p where p.booking_id = b.id), 0)`);
    expect(ledger!.n).toBe(0);
  });

  it("covers every booking status, source and payment state", async () => {
    const statuses = await db.execute<{ status: string }>(sql`select distinct status::text as status from bookings`);
    expect(statuses.map((s) => s.status).sort()).toEqual(
      ["approved", "cancelled_by_business", "cancelled_by_customer", "completed", "expired", "no_show", "pending", "rejected"],
    );
    const sources = await db.execute<{ source: string }>(sql`select distinct source::text as source from bookings`);
    expect(sources.map((s) => s.source).sort()).toEqual(["online", "phone", "walk_in"]);
    const pay = await db.execute<{ s: string }>(sql`select distinct payment_status::text as s from bookings`);
    expect(pay.map((p) => p.s).sort()).toEqual(["paid", "partially_paid", "unpaid"]);
  });

  it("leaves live pending requests that expire later than the seed time", async () => {
    const rows = await db.execute<{ slug: string; n: number; soonest: Date }>(sql`
      select b.slug, count(*)::int as n, min(k.pending_expires_at) as soonest
      from bookings k join businesses b on b.id = k.business_id
      where k.status = 'pending' group by b.slug order by b.slug`);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.n).toBeGreaterThanOrEqual(5);
      expect(new Date(r.soonest).getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  it("gives the demo customer bookings to look at", async () => {
    const rows = await db.execute<{ status: string }>(sql`
      select k.status::text as status from bookings k join users u on u.id = k.customer_user_id
      where u.phone = '+919000000091'`);
    const statuses = new Set(rows.map((r) => r.status));
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(statuses.has("pending")).toBe(true);
    expect(statuses.has("approved")).toBe(true);
    expect(statuses.has("completed")).toBe(true);
  });

  it("restricts staff to one location and answers some reviews", async () => {
    const [m] = await db.execute<{ n: number }>(sql`
      select jsonb_array_length(m.location_ids)::int as n from business_memberships m
      join users u on u.id = m.user_id where u.phone = '+919000000031'`);
    expect(m!.n).toBe(1);
    const [r] = await db.execute<{ answered: number; total: number }>(
      sql`select count(business_response)::int as answered, count(*)::int as total from reviews`,
    );
    expect(r!.answered).toBeGreaterThan(0);
    expect(r!.answered).toBeLessThan(r!.total);
  });

  it("can run again and ends with the same venues", async () => {
    const again = await seedDemo(db, { now: NOW });
    expect(again.businesses).toBe(3);
    expect(again.bookings).toBe(summary.bookings);
    const all = await searchBusinesses(db, {});
    expect(all.total).toBe(3);
  }, 240_000);
});
