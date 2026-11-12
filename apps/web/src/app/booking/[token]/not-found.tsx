import type { Metadata } from "next";
import Link from "next/link";
import { Link2Off } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Link no longer valid",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Shown with status 404 for an unknown, revoked or long-finished booking link. */
export default function BookingLinkNotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start justify-center px-4 py-16 sm:px-6">
        <Link2Off className="size-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">This link is no longer valid</h1>
        <p className="mt-3 max-w-[50ch] text-muted-foreground">
          Booking links stop working 30 days after the booking ends, or when a newer link replaces them. The venue can still
          look your booking up by its reference.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/" className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90">
            Find a venue
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
