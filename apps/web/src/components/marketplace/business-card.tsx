import Link from "next/link";
import { MapPin } from "lucide-react";
import type { BusinessCard as Card } from "@krello/core";
import { priceLabel } from "@/lib/format";
import { safeImageUrl } from "@/lib/site";
import { VenuePanel } from "./category-visual";
import { RatingSummary } from "./rating";

/** One venue in a grid. The whole card is a single link to the venue page. */
export function BusinessCard({ business }: { business: Card }) {
  const cover = safeImageUrl(business.coverUrl);
  const firstCategory = business.categories[0];
  const place = [business.localities[0], business.city].filter(Boolean).join(", ");
  const price = priceLabel(business.priceFrom, business.priceUnit, business.pricePerPerson);

  return (
    <Link
      href={`/${business.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-card border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)] outline-none transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-12px_rgba(0,0,0,0.18)] focus-visible:ring-[3px] focus-visible:ring-ring/50 active:translate-y-0 active:scale-[0.99] motion-reduce:transition-none"
    >
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element -- owner-supplied URLs from any host; next/image would need an allow-list
        <img src={cover} alt="" loading="lazy" className="aspect-[16/10] w-full object-cover" />
      ) : (
        <VenuePanel name={business.name} categorySlug={firstCategory?.slug} className="aspect-[16/10] w-full" />
      )}
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <h3 className="text-lg font-semibold leading-snug tracking-tight">{business.name}</h3>
          {business.categories.length > 0 && <p className="mt-0.5 text-sm text-muted-foreground">{business.categories.map((c) => c.name).join(", ")}</p>}
        </div>
        <div className="mt-auto flex flex-col gap-1.5 text-sm">
          <RatingSummary rating={business.rating} count={business.reviewCount} />
          {place && (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{place}</span>
            </p>
          )}
          {price && <p className="tabular font-medium">{price}</p>}
        </div>
      </div>
    </Link>
  );
}

/** Placeholder with the same footprint, for loading states. */
export function BusinessCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-card border bg-card" aria-hidden="true">
      <div className="aspect-[16/10] animate-pulse bg-muted" />
      <div className="space-y-3 p-5">
        <div className="h-5 w-2/3 animate-pulse rounded-full bg-muted" />
        <div className="h-4 w-1/3 animate-pulse rounded-full bg-muted" />
        <div className="h-4 w-1/2 animate-pulse rounded-full bg-muted" />
      </div>
    </div>
  );
}
