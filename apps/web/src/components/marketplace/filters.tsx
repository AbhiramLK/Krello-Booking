"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { hasFilters, searchHref, SORT_LABEL, SORTS, type SearchQuery, type SearchSort } from "@/lib/search-params";
import { cn } from "@/lib/utils";

const RATINGS = [0, 3, 3.5, 4, 4.5];
const PRICES = [0, 200, 300, 500, 1000];

interface FiltersProps {
  query: SearchQuery;
  categories: { slug: string; name: string }[];
}

function PillSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="relative inline-flex h-10 items-center gap-2 rounded-full border bg-card pl-4 pr-9 text-sm focus-within:ring-[3px] focus-within:ring-ring/50">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer appearance-none bg-transparent py-2 pr-1 font-medium outline-none"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 size-4 text-muted-foreground" aria-hidden="true" />
    </label>
  );
}

/**
 * Category chips and the rating, price and sort dropdowns. Every change is a navigation to a new
 * shareable URL (page reset to 1), so the back button steps through them.
 */
export function Filters({ query, categories }: FiltersProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const go = (patch: Partial<SearchQuery>) => startTransition(() => router.push(searchHref(query, patch)));

  // A price or rating typed into the URL by hand still shows up as the current choice.
  const ratingOptions = RATINGS.includes(query.minRating) ? RATINGS : [...RATINGS, query.minRating].sort((a, b) => a - b);
  const priceOptions = PRICES.includes(query.maxPrice) ? PRICES : [...PRICES, query.maxPrice].sort((a, b) => a - b);

  return (
    <div className={cn("space-y-4 transition-opacity", pending && "opacity-60")} aria-busy={pending}>
      <nav aria-label="Activity" className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
          {[{ slug: "", name: "All activities" }, ...categories].map((category) => {
            const active = query.category === category.slug;
            return (
              <li key={category.slug || "all"}>
                <Link
                  href={searchHref(query, { category: category.slug })}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "inline-flex h-10 items-center whitespace-nowrap rounded-full border px-4 text-sm outline-none transition focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    active ? "border-foreground bg-foreground font-medium text-background" : "bg-card hover:bg-muted",
                  )}
                >
                  {category.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        <PillSelect label="Rating" value={query.minRating} onChange={(v) => go({ minRating: Number(v) })}>
          {ratingOptions.map((r) => (
            <option key={r} value={r}>
              {r === 0 ? "Any" : `${r}+ stars`}
            </option>
          ))}
        </PillSelect>
        <PillSelect label="Price up to" value={query.maxPrice} onChange={(v) => go({ maxPrice: Number(v) })}>
          {priceOptions.map((p) => (
            <option key={p} value={p}>
              {p === 0 ? "Any" : `₹${p.toLocaleString("en-IN")}`}
            </option>
          ))}
        </PillSelect>
        <PillSelect label="Sort" value={query.sort} onChange={(v) => go({ sort: v as SearchSort })}>
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {SORT_LABEL[s]}
            </option>
          ))}
        </PillSelect>
        {hasFilters(query) && (
          <Link href="/search" className="inline-flex h-10 items-center rounded-full px-3 text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
            Clear filters
          </Link>
        )}
        <span role="status" className="sr-only">
          {pending ? "Updating results" : ""}
        </span>
      </div>
    </div>
  );
}
