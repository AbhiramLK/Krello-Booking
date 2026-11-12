import Link from "next/link";
import { MapPin } from "lucide-react";
import type { PublicBusiness } from "@krello/core";
import { safeImageUrl } from "@/lib/site";
import { cn } from "@/lib/utils";
import { VenuePanel } from "./category-visual";
import { RatingSummary } from "./rating";

type Location = PublicBusiness["locations"][number];

/** Cover, name, activities, rating and where it is. Also links the venue's other locations. */
export function BusinessHero({ business, location }: { business: PublicBusiness; location: Location }) {
  const cover = safeImageUrl(business.coverUrl);
  const logo = safeImageUrl(business.logoUrl);
  const firstCategory = business.categories[0];

  return (
    <section aria-labelledby="venue-name">
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element -- owner-supplied URLs from any host; next/image would need an allow-list
        <img src={cover} alt={`${business.name}`} fetchPriority="high" className="aspect-[16/9] w-full rounded-card object-cover sm:aspect-[3/1]" />
      ) : (
        <VenuePanel name={business.name} categorySlug={firstCategory?.slug} size="hero" className="aspect-[16/9] w-full rounded-card sm:aspect-[3/1]" />
      )}

      <div className="mt-6 flex items-start gap-4">
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element -- owner-supplied URLs from any host
          <img src={logo} alt="" className="size-14 shrink-0 rounded-2xl border bg-card object-cover" />
        )}
        <div className="min-w-0">
          <h1 id="venue-name" className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            {business.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <RatingSummary rating={business.rating} count={business.reviewCount} long />
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="size-4 shrink-0" aria-hidden="true" />
              {location.locality}, {location.city}
            </p>
          </div>
          {business.categories.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Activities">
              {business.categories.map((category) => (
                <li key={category.slug}>
                  <Link
                    href={`/c/${category.slug}`}
                    className="inline-flex h-8 items-center rounded-full border bg-card px-3 text-sm outline-none transition hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {business.locations.length > 1 && (
        <nav aria-label="Locations" className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Locations</span>
          {business.locations.map((l) => {
            const current = l.id === location.id;
            return (
              <Link
                key={l.id}
                href={`/${business.slug}/${l.slug}`}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center rounded-full border px-4 text-sm outline-none transition focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  current ? "border-foreground bg-foreground font-medium text-background" : "bg-card hover:bg-muted",
                )}
              >
                {l.locality}
              </Link>
            );
          })}
        </nav>
      )}
    </section>
  );
}
