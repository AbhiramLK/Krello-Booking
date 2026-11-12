"use client";

import type { PublicBusiness } from "@krello/core";

interface BookingPanelProps {
  business: PublicBusiness;
  /** The location the page opened on; the visitor can change it. */
  initialLocationId: string;
}

/** Placeholder. The booking flow replaces this component, keeping these props. */
export function BookingPanel({ business, initialLocationId }: BookingPanelProps) {
  const location = business.locations.find((l) => l.id === initialLocationId) ?? business.locations[0];
  return (
    <section aria-label="Book a slot" className="rounded-card border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight">Book a slot</h2>
      <p className="mt-1 text-sm text-muted-foreground">{location ? `${business.name}, ${location.locality}` : business.name}</p>
      <p className="mt-6 rounded-xl bg-muted/60 px-4 py-6 text-center text-sm font-medium">Booking opens here</p>
    </section>
  );
}
