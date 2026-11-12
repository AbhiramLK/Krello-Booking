import "server-only";
import { cache } from "react";
import type { Metadata } from "next";
import { getPublicBusiness, RESERVED_SLUGS, type PublicBusiness } from "@krello/core";
import { getDb } from "./db";
import { safeImageUrl, siteUrl, truncate } from "./site";

/** One lookup per request, shared by `generateMetadata` and the page. Null when unknown, reserved or not listed. */
export const loadPublicBusiness = cache(async (slug: string): Promise<PublicBusiness | null> => {
  if (RESERVED_SLUGS.has(slug) || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) return null;
  return getPublicBusiness(getDb(), slug);
});

type PublicLocation = PublicBusiness["locations"][number];

export function businessPath(business: Pick<PublicBusiness, "slug">, location?: Pick<PublicLocation, "slug">): string {
  return location ? `/${business.slug}/${location.slug}` : `/${business.slug}`;
}

/** Title, description, canonical and Open Graph for a business page (or one of its location pages). */
export function businessMetadata(business: PublicBusiness, location: PublicLocation, canonicalPath: string): Metadata {
  const place = `${location.locality}, ${location.city}`;
  const activity = business.categories[0]?.name;
  // The em dash is the wording the brief fixes for this title.
  const title = `${business.name} — book ${activity ?? "a slot"} in ${place} | Krello`;
  const cover = safeImageUrl(business.coverUrl);
  const description = truncate(
    business.description?.trim() || `Book ${activity ?? "a slot"} at ${business.name} in ${place}. See what is free and send a request.`,
    155,
  );
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      type: "website",
      siteName: "Krello",
      title,
      description,
      url: canonicalPath,
      ...(cover ? { images: [{ url: cover, alt: business.name }] } : {}),
    },
    twitter: { card: cover ? "summary_large_image" : "summary", title, description },
  };
}

/** schema.org LocalBusiness for search engines, as a JSON string that is safe inside a script tag. */
export function localBusinessJsonLd(business: PublicBusiness, location: PublicLocation, path: string): string {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: business.name,
    url: `${siteUrl}${path}`,
    address: {
      "@type": "PostalAddress",
      streetAddress: location.address,
      addressLocality: location.locality ? `${location.locality}, ${location.city}` : location.city,
      addressRegion: location.state,
      postalCode: location.postalCode,
      addressCountry: "IN",
    },
  };
  if (business.description) data.description = business.description;
  const telephone = location.phone ?? business.contactPhone;
  if (telephone) data.telephone = telephone;
  const cover = safeImageUrl(business.coverUrl);
  if (cover) data.image = cover;
  if (business.reviewCount > 0 && business.rating !== null) {
    data.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: business.rating,
      reviewCount: business.reviewCount,
      bestRating: 5,
      worstRating: 1,
    };
  }
  // Names and descriptions are written by venue owners: stop `</script>` and friends from closing the tag.
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

/** Reviews shown at first and fetched by each "Show more". */
export const REVIEWS_PER_PAGE = 10;
