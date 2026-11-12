import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activityCategories,
  businessCategories,
  businesses,
  locations,
  pricingRules,
  resources,
  reviews,
  subscriptions,
  type Db,
} from "@krello/database";
import { createBooking, resolvePolicy } from "@krello/booking-engine";
import { closeTestDb, customer, CUSTOMER, makeVenue, testDb, type Venue } from "../../booking-engine/test/fixtures";
import { getPublicBusiness, listCategories, listPublicReviews, RESERVED_SLUGS, searchBusinesses, slugify } from "../src";

let db: Db;
beforeAll(() => {
  db = testDb();
});
afterAll(closeTestDb);

/** Shared database: every test names its venues with its own token and searches on that. */
const token = () => randomUUID().replace(/-/g, "").slice(0, 10);

interface Listed extends Venue {
  slug: string;
  name: string;
}

async function listedVenue(
  name: string,
  opts: {
    categoryId?: string;
    /** Base price in paise for every resource. */
    price?: number;
    ratings?: { rating: number; removed?: boolean }[];
    policy?: Record<string, unknown>;
    subscription?: "trialing" | "active" | "grace" | "expired";
    internalNotes?: string;
    customerPhone?: string;
  } = {},
): Promise<Listed> {
  const v = await makeVenue(db, { policy: opts.policy, subscription: opts.subscription });
  const [biz] = await db.update(businesses).set({ name }).where(eq(businesses.id, v.businessId)).returning();
  if (opts.categoryId) await db.insert(businessCategories).values({ businessId: v.businessId, categoryId: opts.categoryId });
  if (opts.price !== undefined) {
    await db
      .update(pricingRules)
      .set({ amount: opts.price })
      .where(and(eq(pricingRules.businessId, v.businessId), eq(pricingRules.ruleType, "base")));
  }
  // Reviews need a booking each, and only the engine writes bookings.
  for (const [i, r] of (opts.ratings ?? []).entries()) {
    const { booking } = await createBooking(db, {
      locationId: v.locationId,
      resourceIds: [v.tables[0]!],
      startsAt: v.at(10 + i),
      endsAt: v.at(11 + i),
      customer: { ...customer(`Guest ${i}`), ...(opts.customerPhone ? { phone: opts.customerPhone } : {}) },
      groupSize: 2,
      source: "online",
      actor: CUSTOMER,
      internalNotes: opts.internalNotes,
    });
    await db.insert(reviews).values({
      bookingId: booking.id,
      businessId: v.businessId,
      locationId: v.locationId,
      authorName: `Reviewer ${i}`,
      rating: r.rating,
      body: `Review body ${i}`,
      moderationStatus: r.removed ? "removed" : "visible",
    });
  }
  return { ...v, slug: biz!.slug, name };
}

async function category(name: string) {
  const [c] = await db
    .insert(activityCategories)
    .values({ name, slug: slugify(`${name}-${randomUUID().slice(0, 6)}`) })
    .returning();
  return c!;
}

const slugsFor = async (q: string, extra: Parameters<typeof searchBusinesses>[1] = {}) =>
  (await searchBusinesses(db, { q, ...extra })).items.map((b) => b.slug);

describe("public listing rules", () => {
  it("shows only venues that are approved, active, listed, subscribed and bookable", async () => {
    const t = token();
    const good = await listedVenue(`Visible ${t}`);
    const trial = await listedVenue(`Trial ${t}`, { subscription: "trialing" });
    const grace = await listedVenue(`Grace ${t}`, { subscription: "grace" });
    const pending = await listedVenue(`Pending ${t}`);
    const suspended = await listedVenue(`Suspended ${t}`);
    const unlisted = await listedVenue(`Unlisted ${t}`);
    const expired = await listedVenue(`Expired ${t}`, { subscription: "expired" });
    const noResource = await listedVenue(`Empty ${t}`);
    const draft = await listedVenue(`Draft ${t}`);
    const rejected = await listedVenue(`Rejected ${t}`);

    await db.update(businesses).set({ verificationStatus: "pending_review" }).where(eq(businesses.id, pending.businessId));
    await db.update(businesses).set({ verificationStatus: "draft" }).where(eq(businesses.id, draft.businessId));
    await db.update(businesses).set({ verificationStatus: "rejected" }).where(eq(businesses.id, rejected.businessId));
    await db.update(businesses).set({ status: "suspended" }).where(eq(businesses.id, suspended.businessId));
    await db.update(businesses).set({ isListed: false }).where(eq(businesses.id, unlisted.businessId));
    await db.update(resources).set({ status: "inactive" }).where(eq(resources.businessId, noResource.businessId));

    const found = await slugsFor(t);
    expect(found.sort()).toEqual([good.slug, trial.slug, grace.slug].sort());

    for (const v of [pending, suspended, unlisted, expired, noResource, draft, rejected]) {
      expect(await getPublicBusiness(db, v.slug), v.name).toBeNull();
    }
    for (const v of [good, trial, grace]) {
      expect(await getPublicBusiness(db, v.slug), v.name).not.toBeNull();
    }
    expect(await getPublicBusiness(db, `no-such-venue-${t}`)).toBeNull();
  });

  it("drops a venue once its only subscription lapses", async () => {
    const t = token();
    const v = await listedVenue(`Lapsing ${t}`);
    expect(await slugsFor(t)).toEqual([v.slug]);
    await db.update(subscriptions).set({ status: "expired" }).where(eq(subscriptions.businessId, v.businessId));
    expect(await slugsFor(t)).toEqual([]);
    expect(await getPublicBusiness(db, v.slug)).toBeNull();
  });
});

describe("search text", () => {
  it("matches business name, locality, category name and resource name, ignoring case", async () => {
    const t = token();
    const cat = await category(`Catfield${t}`);
    const byName = await listedVenue(`Namefield${t} Club`);
    const byLocality = await listedVenue(`Plain A ${t}`);
    const byCategory = await listedVenue(`Plain B ${t}`, { categoryId: cat.id });
    const byResource = await listedVenue(`Plain C ${t}`);
    await db.update(locations).set({ locality: `Localfield${t}` }).where(eq(locations.id, byLocality.locationId));
    await db
      .update(resources)
      .set({ name: `Resfield${t} Court` })
      .where(and(eq(resources.id, byResource.tables[0]!)));

    expect(await slugsFor(`namefield${t}`)).toEqual([byName.slug]);
    expect(await slugsFor(`NAMEFIELD${t}`)).toEqual([byName.slug]);
    expect(await slugsFor(`LOCALFIELD${t}`)).toEqual([byLocality.slug]);
    expect(await slugsFor(`localfield${t}`)).toEqual([byLocality.slug]);
    expect(await slugsFor(`catfield${t}`)).toEqual([byCategory.slug]);
    expect(await slugsFor(`CATFIELD${t}`)).toEqual([byCategory.slug]);
    expect(await slugsFor(`resfield${t}`)).toEqual([byResource.slug]);
    expect(await slugsFor(`RESFIELD${t}`)).toEqual([byResource.slug]);
    expect(await slugsFor(`nothing-matches-${t}`)).toEqual([]);
  });

  it("treats % and _ in the query as literal characters", async () => {
    const t = token();
    const percent = await listedVenue(`Zed ${t} 50% club`);
    const plain = await listedVenue(`Zed ${t} 505 club`);
    const under = await listedVenue(`Yan ${t} a_b hall`);
    const other = await listedVenue(`Yan ${t} aXb hall`);

    expect(await slugsFor(`${t} 50%`)).toEqual([percent.slug]);
    expect(await slugsFor(`${t} a_b`)).toEqual([under.slug]);
    expect(await slugsFor(`%${t}`)).toEqual([]);
    expect(await slugsFor(`_${t}`)).toEqual([]);
    expect(await slugsFor(`${t}\\`)).toEqual([]);
    // The look-alikes are still found by their own text.
    expect(await slugsFor(`${t} 505`)).toEqual([plain.slug]);
    expect(await slugsFor(`${t} aXb`)).toEqual([other.slug]);
  });

  it("treats % in the city filter literally", async () => {
    const t = token();
    const v = await listedVenue(`Cityfilter ${t}`);
    await db.update(locations).set({ city: `Metro${t}` }).where(eq(locations.id, v.locationId));
    expect((await searchBusinesses(db, { q: t, city: `metro${t}` })).items.map((b) => b.slug)).toEqual([v.slug]);
    expect((await searchBusinesses(db, { q: t, city: `%` })).items).toEqual([]);
    expect((await searchBusinesses(db, { q: t, city: `Metro_${t.slice(1)}` })).items).toEqual([]);
  });

  it("filters by category slug", async () => {
    const t = token();
    const cat = await category(`Filtercat${t}`);
    const inCat = await listedVenue(`Catfilter A ${t}`, { categoryId: cat.id });
    await listedVenue(`Catfilter B ${t}`);
    const res = await searchBusinesses(db, { q: t, category: cat.slug });
    expect(res.items.map((b) => b.slug)).toEqual([inCat.slug]);
    expect(res.items[0]!.categories).toEqual([{ slug: cat.slug, name: cat.name }]);
    expect((await listCategories(db)).map((c) => c.slug)).toContain(cat.slug);
  });
});

describe("sorting and ratings", () => {
  let cheap: Listed, mid: Listed, dear: Listed, t: string;

  beforeAll(async () => {
    t = token();
    cheap = await listedVenue(`Ranked cheap ${t}`, { price: 10000, ratings: [{ rating: 4 }, { rating: 3 }] });
    mid = await listedVenue(`Ranked mid ${t}`, { price: 20000, ratings: [{ rating: 5 }, { rating: 4 }] });
    // The removed one-star must not drag a perfect 5 down.
    dear = await listedVenue(`Ranked dear ${t}`, { price: 30000, ratings: [{ rating: 5 }, { rating: 1, removed: true }] });
  });

  it("sorts by lowest base price, either way", async () => {
    expect(await slugsFor(t, { sort: "price_asc" })).toEqual([cheap.slug, mid.slug, dear.slug]);
    expect(await slugsFor(t, { sort: "price_desc" })).toEqual([dear.slug, mid.slug, cheap.slug]);
    const items = (await searchBusinesses(db, { q: t, sort: "price_asc" })).items;
    expect(items.map((b) => b.priceFrom)).toEqual([10000, 20000, 30000]);
  });

  it("applies the price ceiling", async () => {
    expect(await slugsFor(t, { maxPrice: 20000, sort: "price_asc" })).toEqual([cheap.slug, mid.slug]);
  });

  it("ignores removed reviews in ratings and counts", async () => {
    const items = (await searchBusinesses(db, { q: t, sort: "rating" })).items;
    expect(items.map((b) => [b.slug, b.rating, b.reviewCount])).toEqual([
      [dear.slug, 5, 1],
      [mid.slug, 4.5, 2],
      [cheap.slug, 3.5, 2],
    ]);
    const page = await getPublicBusiness(db, dear.slug);
    expect(page).toMatchObject({ rating: 5, reviewCount: 1 });
    const shown = await listPublicReviews(db, dear.businessId);
    expect(shown.map((r) => r.rating)).toEqual([5]);
  });

  it("labels the card price with the unit of the resource that sets it", async () => {
    const t2 = token();
    const v = await listedVenue(`Unit ${t2}`);
    const [card] = (await searchBusinesses(db, { q: t2 })).items;
    // Cheapest base rule is the shared per-person session at 150 rupees, not a 300 rupee table.
    expect(card).toMatchObject({ priceFrom: 15000, priceUnit: "per_slot", pricePerPerson: true, city: "Bengaluru", localities: ["Indiranagar"] });

    // Retiring that resource moves the price and the label to the next cheapest.
    await db.update(resources).set({ status: "inactive" }).where(eq(resources.id, v.session));
    const [after] = (await searchBusinesses(db, { q: t2 })).items;
    expect(after).toMatchObject({ priceFrom: 30000, priceUnit: "per_hour", pricePerPerson: false });
  });

  it("excludes venues under the minimum rating", async () => {
    expect(await slugsFor(t, { minRating: 4, sort: "rating" })).toEqual([dear.slug, mid.slug]);
    expect(await slugsFor(t, { minRating: 3.5 })).toHaveLength(3);
    expect(await slugsFor(t, { minRating: 4.6 })).toEqual([dear.slug]);
  });

  it("pages results and reports the total for the query", async () => {
    const first = await searchBusinesses(db, { q: t, sort: "price_asc", pageSize: 2, page: 1 });
    const second = await searchBusinesses(db, { q: t, sort: "price_asc", pageSize: 2, page: 2 });
    expect(first.total).toBe(3);
    expect(first.items.map((b) => b.slug)).toEqual([cheap.slug, mid.slug]);
    expect(second.items.map((b) => b.slug)).toEqual([dear.slug]);
  });
});

describe("what the public page exposes", () => {
  const PHONE = "+917770001234";
  const NOTE = "INTERNAL-ONLY-NOTE";
  let v: Listed;

  beforeAll(async () => {
    v = await listedVenue(`Privacy ${token()}`, {
      ratings: [{ rating: 5 }, { rating: 2 }],
      customerPhone: PHONE,
      internalNotes: NOTE,
      policy: { pendingHoldMinutes: 45, customerCanCancelApproved: false, someFutureSetting: { x: 1 } },
    });
  });

  it("returns the resolved policy with exactly its five known keys", async () => {
    const page = (await getPublicBusiness(db, v.slug))!;
    expect(Object.keys(page.policy).sort()).toEqual(
      ["cancellationDeadlineMinutes", "cancellationReasonRequired", "customerCanCancelApproved", "customerCanCancelPending", "pendingHoldMinutes"],
    );
    expect(page.policy).toEqual(resolvePolicy({ pendingHoldMinutes: 45, customerCanCancelApproved: false }));
    expect(page.policy.pendingHoldMinutes).toBe(45);
    expect(page.policyLines.length).toBeGreaterThan(2);
    expect(JSON.stringify(page)).not.toContain("someFutureSetting");
  });

  it("carries no owner, internal notes or customer phone numbers", async () => {
    const page = (await getPublicBusiness(db, v.slug))!;
    const reviewsShown = await listPublicReviews(db, v.businessId);
    const cards = (await searchBusinesses(db, { q: v.name })).items;
    expect(reviewsShown).toHaveLength(2);
    expect(cards).toHaveLength(1);

    for (const payload of [page, reviewsShown, cards]) {
      const json = JSON.stringify(payload);
      expect(json).not.toContain(PHONE);
      expect(json).not.toContain(NOTE);
      expect(json).not.toContain(v.ownerId);
      expect(json).not.toMatch(/ownerUserId|internalNotes|customerPhone|verificationStatus/);
    }
    expect(page).not.toHaveProperty("ownerUserId");
    expect(page).not.toHaveProperty("internalNotes");
  });

  it("describes each location with its hours, resources and the lowest price per resource", async () => {
    const page = (await getPublicBusiness(db, v.slug))!;
    expect(page.locations).toHaveLength(1);
    const loc = page.locations[0]!;
    expect(loc).toMatchObject({ slug: "main", locality: "Indiranagar", city: "Bengaluru", timezone: "Asia/Kolkata" });
    expect(loc.hours).toHaveLength(7);
    expect(loc.hours[0]).toMatchObject({ opensMinute: 540, closesMinute: 1380 });
    expect(loc.resources.map((r) => r.name).sort()).toEqual(["Open swim", "Table 1", "Table 2", "Table 3"]);
    const swim = loc.resources.find((r) => r.name === "Open swim")!;
    expect(swim).toMatchObject({ pricePerPerson: true, priceUnit: "per_slot", priceFrom: 15000 });
    // Tables also have a dearer evening rule; the lowest rule is what "from" shows.
    expect(loc.resources.find((r) => r.name === "Table 1")!.priceFrom).toBe(30000);
  });
});

describe("slugs", () => {
  it("makes URL-safe slugs", () => {
    expect(slugify("Cue Masters — Snooker & Pool!")).toBe("cue-masters-snooker-pool");
    expect(slugify("  Café  Déjà-vu  ")).toBe("cafe-deja-vu");
  });

  it("keeps app paths for the app", () => {
    expect(RESERVED_SLUGS.has("dashboard")).toBe(true);
    expect(RESERVED_SLUGS.has("search")).toBe(true);
    expect(RESERVED_SLUGS.has("c")).toBe(true);
    expect(RESERVED_SLUGS.has("cue-masters")).toBe(false);
  });
});
