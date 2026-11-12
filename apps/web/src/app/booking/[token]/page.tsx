import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { viewBookingByToken } from "@krello/core";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getDb } from "@/lib/db";
import { toStatusBooking } from "./status-booking";
import { StatusView } from "./status-view";

// The URL holds a secret: never cache, index or leak it. The Referrer-Policy and
// X-Robots-Tag headers are also set for /booking/* in next.config.ts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your booking",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Props = { params: Promise<{ token: string }> };

export default async function BookingStatusPage({ params }: Props) {
  const { token } = await params;
  const found = await viewBookingByToken(getDb(), token);
  if (!found) notFound();

  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <StatusView source={{ kind: "token", token }} booking={toStatusBooking(found.view)} />
      </main>
      <SiteFooter />
    </>
  );
}
