import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { viewBookingByToken } from "@krello/core";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getDb } from "@/lib/db";
import { StatusView, type StatusBooking } from "./status-view";

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

  // Only the customer view crosses to the browser; the booking row holds staff notes and the phone.
  const v = found.view;
  const booking: StatusBooking = {
    reference: v.reference,
    status: v.status,
    customerName: v.customerName,
    groupSize: v.groupSize,
    startsAt: v.startsAt.toISOString(),
    endsAt: v.endsAt.toISOString(),
    pendingExpiresAt: v.pendingExpiresAt?.toISOString() ?? null,
    rejectionReason: v.rejectionReason,
    cancellationReason: v.cancellationReason,
    totalAmount: v.totalAmount,
    venue: v.venue,
    items: v.items,
    canCancel: v.canCancel,
    cancelDeadline: v.cancelDeadline?.toISOString() ?? null,
    cancellationReasonRequired: v.cancellationReasonRequired,
  };

  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <StatusView token={token} booking={booking} />
      </main>
      <SiteFooter />
    </>
  );
}
