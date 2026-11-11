import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  activityCategories,
  businesses,
  locationHours,
  locations,
  resources,
  reviews,
  type DbOrTx,
} from "@krello/database";
import { describePolicy, resolvePolicy } from "@krello/booking-engine";

/** Paths the app itself uses; a business may not take one as its slug. */
export const RESERVED_SLUGS = new Set([
  "admin", "api", "account", "auth", "booking", "bookings", "business", "c", "category", "dashboard", "login",
  "logout", "search", "signup", "static", "public", "favicon.ico", "robots.txt", "sitemap.xml", "manifest.webmanifest",
  "sw.js", "_next", "about", "help", "terms", "privacy", "pricing", "for-business", "me", "favourites", "onboarding",
]);

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * SQL condition for "this business may be shown and booked publicly":
 * verified, active, listed by its owner, with a usable subscription.
 */
export const isPubliclyListed = sql`(
  ${businesses.verificationStatus} = 'approved'
  and ${businesses.status} = 'active'
  and ${businesses.isListed}
  and exists (
    select 1 from subscriptions s
    where s.business_id = ${businesses.id} and s.status in ('trialing', 'active', 'grace')
  )
  and exists (
    select 1 from resources r
    where r.business_id = ${businesses.id} and r.status = 'active'
  )
)`;

export async function listCategories(db: DbOrTx) {
  return db
    .select()
    .from(activityCategories)
    .where(eq(activityCategories.status, "active"))
    .orderBy(asc(activityCategories.sortOrder), asc(activityCategories.name));
}

export interface BusinessCard {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  coverUrl: string | null;
  logoUrl: string | null;
  categories: { slug: string; name: string }[];
  localities: string[];
  city: string | null;
  rating: number | null;
  reviewCount: number;
  /** Lowest configured price in paise, if any. */
  priceFrom: number | null;
  priceUnit: "per_hour" | "per_slot" | null;
}

export interface SearchInput {
  q?: string;
  category?: string;
  city?: string;
  minRating?: number;
  maxPrice?: number;
  sort?: "relevance" | "price_asc" | "price_desc" | "rating";
  page?: number;
  pageSize?: number;
}

export async function searchBusinesses(db: DbOrTx, input: SearchInput = {}): Promise<{ items: BusinessCard[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.min(Math.max(input.pageSize ?? 12, 1), 48);
  const page = Math.max(input.page ?? 1, 1);
  const q = input.q?.trim().slice(0, 80);
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;

  const rating = sql<number | null>`(select round(avg(rv.rating)::numeric, 1)::float from reviews rv where rv.business_id = ${businesses.id} and rv.moderation_status = 'visible')`;
  const reviewCount = sql<number>`(select count(*)::int from reviews rv where rv.business_id = ${businesses.id} and rv.moderation_status = 'visible')`;
  const priceFrom = sql<number | null>`(select min(pr.amount) from pricing_rules pr where pr.business_id = ${businesses.id} and pr.status = 'active' and pr.rule_type = 'base')`;

  const filters = [isPubliclyListed];
  if (like) {
    filters.push(sql`(
      ${businesses.name} ilike ${like} or ${businesses.description} ilike ${like}
      or exists (select 1 from locations l where l.business_id = ${businesses.id} and (l.locality ilike ${like} or l.city ilike ${like} or l.postal_code ilike ${like}))
      or exists (select 1 from business_categories bc join activity_categories ac on ac.id = bc.category_id where bc.business_id = ${businesses.id} and ac.name ilike ${like})
      or exists (select 1 from resources r where r.business_id = ${businesses.id} and r.status = 'active' and (r.name ilike ${like} or r.resource_type ilike ${like}))
      or ${businesses.amenities}::text ilike ${like}
    )`);
  }
  if (input.category) {
    filters.push(sql`exists (select 1 from business_categories bc join activity_categories ac on ac.id = bc.category_id where bc.business_id = ${businesses.id} and ac.slug = ${input.category})`);
  }
  if (input.city) {
    filters.push(sql`exists (select 1 from locations l where l.business_id = ${businesses.id} and l.status = 'active' and (l.city ilike ${input.city} or l.locality ilike ${input.city}))`);
  }
  if (input.minRating) filters.push(sql`${rating} >= ${input.minRating}`);
  if (input.maxPrice) filters.push(sql`${priceFrom} <= ${input.maxPrice}`);
  const where = and(...filters);

  const order =
    input.sort === "price_asc"
      ? sql`${priceFrom} asc nulls last`
      : input.sort === "price_desc"
        ? sql`${priceFrom} desc nulls last`
        : input.sort === "rating"
          ? sql`${rating} desc nulls last`
          : like
            ? sql`(${businesses.name} ilike ${like}) desc, ${rating} desc nulls last`
            : sql`${rating} desc nulls last`;

  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: businesses.id,
        slug: businesses.slug,
        name: businesses.name,
        description: businesses.description,
        coverUrl: businesses.coverUrl,
        logoUrl: businesses.logoUrl,
        rating,
        reviewCount,
        priceFrom,
        priceUnit: sql<"per_hour" | "per_slot" | null>`(select r.price_unit from resources r where r.business_id = ${businesses.id} and r.status = 'active' order by r.sort_order limit 1)`,
        categories: sql<{ slug: string; name: string }[]>`coalesce((select json_agg(json_build_object('slug', ac.slug, 'name', ac.name) order by ac.sort_order) from business_categories bc join activity_categories ac on ac.id = bc.category_id where bc.business_id = ${businesses.id}), '[]'::json)`,
        localities: sql<string[]>`coalesce((select json_agg(distinct l.locality) from locations l where l.business_id = ${businesses.id} and l.status = 'active'), '[]'::json)`,
        city: sql<string | null>`(select l.city from locations l where l.business_id = ${businesses.id} and l.status = 'active' limit 1)`,
      })
      .from(businesses)
      .where(where)
      .orderBy(order, asc(businesses.name))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(businesses).where(where),
  ]);

  return { items: rows, total: count?.n ?? 0, page, pageSize };
}

/** Everything the public business page shows. Returns null if not listed. */
export async function getPublicBusiness(db: DbOrTx, slug: string) {
  const [business] = await db
    .select({
      id: businesses.id,
      slug: businesses.slug,
      name: businesses.name,
      description: businesses.description,
      contactPhone: businesses.contactPhone,
      logoUrl: businesses.logoUrl,
      coverUrl: businesses.coverUrl,
      galleryUrls: businesses.galleryUrls,
      amenities: businesses.amenities,
      policy: businesses.policy,
    })
    .from(businesses)
    .where(and(eq(businesses.slug, slug), isPubliclyListed));
  if (!business) return null;

  const [locs, hours, cats, summary, resourceRows] = await Promise.all([
    db
      .select()
      .from(locations)
      .where(and(eq(locations.businessId, business.id), eq(locations.status, "active")))
      .orderBy(asc(locations.name)),
    db.select().from(locationHours).where(eq(locationHours.businessId, business.id)).orderBy(asc(locationHours.dayOfWeek), asc(locationHours.opensMinute)),
    db.execute<{ slug: string; name: string }>(
      sql`select ac.slug, ac.name from business_categories bc join activity_categories ac on ac.id = bc.category_id where bc.business_id = ${business.id} order by ac.sort_order`,
    ),
    db
      .select({ rating: sql<number | null>`round(avg(${reviews.rating})::numeric, 1)::float`, count: sql<number>`count(*)::int` })
      .from(reviews)
      .where(and(eq(reviews.businessId, business.id), eq(reviews.moderationStatus, "visible"))),
    db
      .select({
        id: resources.id,
        locationId: resources.locationId,
        name: resources.name,
        resourceType: resources.resourceType,
        description: resources.description,
        bookingMode: resources.bookingMode,
        capacity: resources.capacity,
        priceUnit: resources.priceUnit,
        pricePerPerson: resources.pricePerPerson,
        advanceDays: resources.advanceDays,
        priceFrom: sql<number | null>`(select min(pr.amount) from pricing_rules pr where pr.resource_id = ${resources.id} and pr.status = 'active')`,
      })
      .from(resources)
      .where(and(eq(resources.businessId, business.id), eq(resources.status, "active")))
      .orderBy(asc(resources.sortOrder), asc(resources.name)),
  ]);

  const policy = resolvePolicy(business.policy);
  const { policy: _raw, ...pub } = business;
  return {
    ...pub,
    categories: [...cats],
    rating: summary[0]?.rating ?? null,
    reviewCount: summary[0]?.count ?? 0,
    policy,
    policyLines: describePolicy(policy),
    locations: locs.map((l) => ({
      id: l.id,
      name: l.name,
      slug: l.slug,
      address: l.address,
      locality: l.locality,
      city: l.city,
      state: l.state,
      postalCode: l.postalCode,
      phone: l.phone,
      timezone: l.timezone,
      hours: hours.filter((h) => h.locationId === l.id).map((h) => ({ dayOfWeek: h.dayOfWeek, opensMinute: h.opensMinute, closesMinute: h.closesMinute })),
      resources: resourceRows.filter((r) => r.locationId === l.id),
    })),
  };
}

export type PublicBusiness = NonNullable<Awaited<ReturnType<typeof getPublicBusiness>>>;

export async function listPublicReviews(db: DbOrTx, businessId: string, opts: { page?: number; pageSize?: number } = {}) {
  const pageSize = Math.min(opts.pageSize ?? 10, 50);
  const page = Math.max(opts.page ?? 1, 1);
  return db
    .select({
      id: reviews.id,
      authorName: reviews.authorName,
      rating: reviews.rating,
      body: reviews.body,
      businessResponse: reviews.businessResponse,
      respondedAt: reviews.respondedAt,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .where(and(eq(reviews.businessId, businessId), eq(reviews.moderationStatus, "visible")))
    .orderBy(desc(reviews.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
}
