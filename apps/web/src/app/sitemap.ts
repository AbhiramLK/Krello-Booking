import type { MetadataRoute } from "next";
import { listCategories, searchBusinesses } from "@krello/core";
import { getDb } from "@/lib/db";
import { siteUrl } from "@/lib/site";

// Listings change whenever a venue is approved or switched off, so this is built per request, not at build time.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = getDb();
  const categories = await listCategories(db);

  const slugs: string[] = [];
  // searchBusinesses caps a page at 48 rows, so walk the pages. The bound only guards against a runaway loop.
  for (let page = 1; page <= 200; page++) {
    const result = await searchBusinesses(db, { sort: "relevance", page, pageSize: 48 });
    slugs.push(...result.items.map((b) => b.slug));
    if (slugs.length >= result.total || result.items.length === 0) break;
  }

  return [
    { url: `${siteUrl}/`, changeFrequency: "daily", priority: 1 },
    ...categories.map((c) => ({ url: `${siteUrl}/c/${c.slug}`, changeFrequency: "daily" as const, priority: 0.7 })),
    ...slugs.map((slug) => ({ url: `${siteUrl}/${slug}`, changeFrequency: "daily" as const, priority: 0.8 })),
  ];
}
