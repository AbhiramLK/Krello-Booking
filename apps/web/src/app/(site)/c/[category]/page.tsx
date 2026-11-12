import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { listCategories, searchBusinesses } from "@krello/core";
import { BusinessCard } from "@/components/marketplace/business-card";
import { categoryLook } from "@/components/marketplace/category-visual";
import { Pagination } from "@/components/marketplace/pagination";
import { SearchBar } from "@/components/marketplace/search-bar";
import { getDb } from "@/lib/db";
import { pageCount, parseSearchParams, type RawParams } from "@/lib/search-params";

const PAGE_SIZE = 12;

async function loadCategory(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(slug)) return null;
  return (await listCategories(getDb())).find((c) => c.slug === slug) ?? null;
}

export async function generateMetadata({ params, searchParams }: { params: Promise<{ category: string }>; searchParams: Promise<RawParams> }): Promise<Metadata> {
  const { category: slug } = await params;
  const category = await loadCategory(slug);
  if (!category) return { title: "Not found" };
  const page = parseSearchParams(await searchParams).page;
  return {
    title: `${category.name} venues`,
    description: category.description ?? `Find and book ${category.name.toLowerCase()} venues. See what is free and send a booking request.`,
    alternates: { canonical: page > 1 ? `/c/${category.slug}?page=${page}` : `/c/${category.slug}` },
  };
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ category: string }>; searchParams: Promise<RawParams> }) {
  const { category: slug } = await params;
  const category = await loadCategory(slug);
  if (!category) notFound();

  const page = parseSearchParams(await searchParams).page;
  const result = await searchBusinesses(getDb(), { category: category.slug, sort: "rating", page, pageSize: PAGE_SIZE });
  const { Icon, panel, ink } = categoryLook(category.slug);

  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex items-start gap-4 sm:gap-5">
        <span aria-hidden="true" className={`inline-flex size-14 shrink-0 items-center justify-center rounded-2xl ${panel} ${ink} sm:size-16`}>
          <Icon className="size-7 sm:size-8" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{category.name}</h1>
          {category.description && <p className="mt-1.5 max-w-[60ch] text-muted-foreground">{category.description}</p>}
        </div>
      </header>

      <SearchBar className="mt-8" hidden={{ category: category.slug }} />

      <div className="mt-8 flex items-center justify-between gap-4">
        <p role="status" className="tabular text-sm text-muted-foreground">
          {result.total === 0 ? "No venues yet" : `${result.total} ${result.total === 1 ? "venue" : "venues"}`}
        </p>
        <Link
          href={`/search?category=${category.slug}`}
          className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          Filter and sort
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>

      {result.items.length === 0 ? (
        <div className="mt-4 rounded-card border bg-card px-6 py-14 text-center">
          <p className="text-lg font-medium">{page > 1 ? "That page has no venues." : `No ${category.name.toLowerCase()} venues are open for booking yet.`}</p>
          <Link
            href={page > 1 ? `/c/${category.slug}` : "/search"}
            className="mt-5 inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground outline-none transition hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {page > 1 ? "Back to the first page" : "Browse all venues"}
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

      <Pagination page={page} pages={pageCount(result.total, PAGE_SIZE)} hrefFor={(p) => (p > 1 ? `/c/${category.slug}?page=${p}` : `/c/${category.slug}`)} />
    </main>
  );
}
