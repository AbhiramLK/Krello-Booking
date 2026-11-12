import { Check, MapPin, Phone, Users } from "lucide-react";
import { dayOfWeek, localDateOf } from "@krello/booking-engine";
import { listPublicReviews, type PublicBusiness } from "@krello/core";
import { BookingPanel } from "@/components/booking/booking-panel";
import { getDb } from "@/lib/db";
import { priceLabel } from "@/lib/format";
import { localBusinessJsonLd, REVIEWS_PER_PAGE } from "@/lib/public-business";
import { BusinessHero } from "./business-hero";
import { HoursTable } from "./hours-table";
import { ReviewList } from "./review-list";

type Location = PublicBusiness["locations"][number];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t pt-8">
      <h2 id={id} className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** `Koramangala` when the location is named after its area, otherwise `Main branch, Koramangala`. */
const placeName = (l: Location) => (l.name.toLowerCase() === l.locality.toLowerCase() ? l.name : `${l.name}, ${l.locality}`);

const mapsLink = (l: Location) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${l.address}, ${l.locality}, ${l.city} ${l.postalCode}`)}`;

/** Whole-number places as words people use: "Up to 4 people", "10 places". */
function capacityLabel(r: Location["resources"][number]): string {
  if (r.bookingMode === "shared") return `${r.capacity} places per slot`;
  return r.capacity > 1 ? `Up to ${r.capacity} people` : "Private use";
}

/**
 * The public page for a venue, shared by `/<slug>` and `/<slug>/<location>`.
 * `location` decides which location opens first in the heading and the booking panel.
 */
export async function BusinessView({ business, location, path }: { business: PublicBusiness; location: Location; path: string }) {
  const reviews = await listPublicReviews(getDb(), business.id, { pageSize: REVIEWS_PER_PAGE });
  const now = new Date();
  // Locations are listed starting with the one this page was opened on.
  const ordered = [location, ...business.locations.filter((l) => l.id !== location.id)];
  const multi = ordered.length > 1;

  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: localBusinessJsonLd(business, location, path) }} />
      <BusinessHero business={business} location={location} />

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-12">
        {/* Booking comes right after the heading on a phone, and sits beside the details on a wide screen. */}
        <div className="min-w-0 lg:col-start-2 lg:row-start-1 lg:self-start lg:sticky lg:top-20">
          <BookingPanel business={business} initialLocationId={location.id} />
        </div>

        <div className="space-y-8 lg:col-start-1 lg:row-start-1">
          {business.description && (
            <Section id="about" title="About">
              <p className="max-w-[65ch] whitespace-pre-line leading-relaxed text-foreground/90">{business.description}</p>
            </Section>
          )}

          {business.amenities.length > 0 && (
            <Section id="amenities" title="Amenities">
              <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {business.amenities.map((amenity) => (
                  <li key={amenity} className="flex items-center gap-3 text-[15px]">
                    <Check className="size-4 shrink-0 text-[#1b7a35]" aria-hidden="true" />
                    {amenity}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section id="hours" title="Opening hours">
            <div className="space-y-6">
              {ordered.map((l) => (
                <div key={l.id}>
                  {multi && <h3 className="mb-2 px-3 text-sm font-medium">{placeName(l)}</h3>}
                  <HoursTable hours={l.hours} today={dayOfWeek(localDateOf(now, l.timezone))} />
                  <p className="mt-2 px-3 text-xs text-muted-foreground">Times are local to the venue ({l.timezone.replace("_", " ")}).</p>
                </div>
              ))}
            </div>
          </Section>

          <Section id="resources" title="What you can book">
            <div className="space-y-6">
              {ordered.map((l) => (
                <div key={l.id}>
                  {multi && <h3 className="mb-3 text-sm font-medium">{placeName(l)}</h3>}
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {l.resources.map((r) => {
                      const price = priceLabel(r.priceFrom, r.priceUnit, r.pricePerPerson);
                      return (
                        <li key={r.id} className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
                          <div>
                            <p className="font-medium">{r.name}</p>
                            {r.description && <p className="mt-0.5 text-sm text-muted-foreground">{r.description}</p>}
                          </div>
                          <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pt-1 text-sm">
                            <span className="tabular font-medium">{price ?? "Price on request"}</span>
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <Users className="size-3.5" aria-hidden="true" />
                              {capacityLabel(r)}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </Section>

          <Section id="policy" title="Booking and cancellation">
            <ul className="max-w-[65ch] space-y-3 text-[15px] leading-relaxed">
              {business.policyLines.map((line) => (
                <li key={line} className="flex gap-3">
                  <span aria-hidden="true" className="mt-2.5 size-1 shrink-0 rounded-full bg-muted-foreground" />
                  {line}
                </li>
              ))}
            </ul>
          </Section>

          <Section id="reviews" title={business.reviewCount > 0 ? `Reviews (${business.reviewCount})` : "Reviews"}>
            <ReviewList
              slug={business.slug}
              timezone={location.timezone}
              total={business.reviewCount}
              pageSize={REVIEWS_PER_PAGE}
              initial={reviews.map((r) => ({
                id: r.id,
                authorName: r.authorName,
                rating: r.rating,
                body: r.body,
                businessResponse: r.businessResponse,
                createdAt: r.createdAt.toISOString(),
              }))}
            />
          </Section>

          <Section id="contact" title="Contact and address">
            <ul className="grid gap-4 sm:grid-cols-2">
              {ordered.map((l) => {
                const phone = l.phone ?? business.contactPhone;
                return (
                  <li key={l.id} className="rounded-2xl border bg-card p-4 text-[15px]">
                    {multi && <p className="mb-1 font-medium">{l.name}</p>}
                    <address className="not-italic leading-relaxed text-muted-foreground">
                      {l.address}
                      <br />
                      {l.locality}, {l.city}, {l.state} {l.postalCode}
                    </address>
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
                      <a href={mapsLink(l)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
                        <MapPin className="size-4" aria-hidden="true" />
                        Get directions
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                      {phone && (
                        <a href={`tel:${phone.replace(/[^+\d]/g, "")}`} className="tabular inline-flex items-center gap-1.5 rounded text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
                          <Phone className="size-4" aria-hidden="true" />
                          {phone}
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>
        </div>
      </div>
    </main>
  );
}
