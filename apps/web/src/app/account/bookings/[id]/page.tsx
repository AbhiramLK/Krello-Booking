import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { viewCustomerBooking } from "@krello/core";
import { toStatusBooking } from "@/app/booking/[token]/status-booking";
import { StatusView } from "@/app/booking/[token]/status-view";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { bookingIdSchema } from "../../schemas";

export const dynamic = "force-dynamic";

export const metadata = { title: "Your booking" };

export default async function AccountBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const parsed = bookingIdSchema.safeParse((await params).id);
  if (!parsed.success) notFound();
  const id = parsed.data;
  const user = await requireUser(`/account/bookings/${id}`);

  // Someone else's booking is indistinguishable from one that does not exist.
  const found = await viewCustomerBooking(getDb(), user.id, id);
  if (!found) notFound();

  return (
    <div className="max-w-xl">
      <Link
        href="/account"
        className="-ml-1 mb-5 inline-flex items-center gap-1 rounded-md px-1 py-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        My bookings
      </Link>
      <StatusView source={{ kind: "account", bookingId: id }} booking={toStatusBooking(found.view)} />
    </div>
  );
}
