import type { Metadata } from "next";
import Link from "next/link";
import { listCategories, searchBusinesses } from "@krello/core";
import { BusinessCard } from "@/components/marketplace/business-card";
import { Filters } from "@/components/marketplace/filters";
import { Pagination } from "@/components/marketplace/pagination";
import { SearchBar } from "@/components/marketplace/search-bar";
import { getDb } from "@/lib/db";
import { hasFilters, pageCount, parseSearchParams, searchHref, toSearchInput, type RawParams } from "@/lib/search-params";

const PAGE_SIZE = 12;

export async function generateMetadata({ searchParams }: { searchParams: Promise<RawParams> }): Promise<Metadata> {
  const query = parseSearchParams(await searchParams);
  return {
    title: query.q ? `Venues for "${query.q}"` : "Find a venue",
    description: "Search courts, tables, lanes and studios. See what is free and send a booking request.",
    alternates: { canonical: "/search" },
    // Filtered and paged views repeat the same venues; only the plain page is for search engines.
    robots: hasFilters(query) || query.page > 1 ? { index: false, follow: true } : undefined,
  };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const query = parseSearchParams(await searchParams);
  const db = getDb();
  const [categories, result] = await Promise.all([listCategories(db), searchBusinesses(db, toSearchInput(query, PAGE_SIZE))]);
  const pages = pageCount(result.total, PAGE_SIZE);
  const activeCategory = categories.find((c) => c.slug === query.category);

  // A page past the end (an old link, or filters narrowed since) gets a way back instead of a blank screen.
  const pastEnd = result.items.length === 0 && query.page > 1 && result.total > 0;

  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{activeCategory ? activeCategory.name : "Find a venue"}</h1>
      <SearchBar
        className="mt-6"
        q={query.q}
        city={query.city}
        hidden={{ category: query.category, sort: query.sort === "relevance" ? "" : query.sort, minRating: query.minRating, maxPrice: query.maxPrice }}
      />
      <div className="mt-6">
        <Filters query={query} categories={categories.map((c) => ({ slug: c.slug, name: c.name }))} />
      </div>

      <p role="status" className="tabular mt-8 text-sm text-muted-foreground">
        {result.total === 0 ? "No venues" : `${result.total} ${result.total === 1 ? "venue" : "venues"}`}
        {query.q && ` for "${query.q}"`}
        {query.city && ` in ${query.city}`}
      </p>

      {result.items.length === 0 ? (
        <div className="mt-4 rounded-card border bg-card px-6 py-14 text-center">
          <p className="text-lg font-medium">{pastEnd ? "That page has no venues." : "No venues match. Try a different area or activity."}</p>
          <Link
            href={pastEnd ? searchHref(query, { page: 1 }) : "/search"}
            className="mt-5 inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground outline-none transition hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {pastEnd ? "Back to the first page" : "Clear filters"}
          </Link>
        </div>
      ) : (
        <ul className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {result.items.map((business) => (
            <li key={business.id}>
              <BusinessCard business={business} />
            </li>
          ))}
        </ul>
      )}

      <Pagination page={query.page} pages={pages} hrefFor={(page) => searchHref(query, { page })} />
    </main>
  );
}
