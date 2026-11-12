import Link from "next/link";
import { listCustomerBookings } from "@krello/core";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { BookingRow, type BookingListItem } from "./booking-row";

export const dynamic = "force-dynamic";

export const metadata = { title: "My bookings" };

/** Still to come: a request or a confirmed booking that has not ended. */
function isUpcoming(b: BookingListItem, now: Date): boolean {
  return (b.status === "pending" || b.status === "approved") && b.endsAt.getTime() > now.getTime();
}

function List({ bookings, label }: { bookings: BookingListItem[]; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {bookings.map((b) => (
        <BookingRow key={b.id} booking={b} />
      ))}
    </ul>
  );
}

export default async function AccountBookingsPage() {
  const user = await requireUser("/account");
  const now = new Date();
  const all = await listCustomerBookings(getDb(), user.id, now);

  // The list arrives newest first. What is coming up reads better soonest first.
  const upcoming = all.filter((b) => isUpcoming(b, now)).reverse();
  const past = all.filter((b) => !isUpcoming(b, now));

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">My bookings</h1>
      <p className="mt-1 text-muted-foreground">Requests you have sent and the bookings that came of them.</p>

      <Tabs defaultValue="upcoming" className="mt-6 gap-5">
        <TabsList className="h-11 w-full sm:w-fit" aria-label="Bookings">
          <TabsTrigger value="upcoming" className="h-9 px-4 sm:flex-none">
            Upcoming <span className="tabular text-muted-foreground">({upcoming.length})</span>
          </TabsTrigger>
          <TabsTrigger value="past" className="h-9 px-4 sm:flex-none">
            Past <span className="tabular text-muted-foreground">({past.length})</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming">
          {upcoming.length ? (
            <List bookings={upcoming} label="Upcoming bookings" />
          ) : (
            <p className="rounded-card border bg-card p-6 text-[15px]">
              No upcoming bookings.{" "}
              <Link href="/" className="font-medium text-primary hover:underline">
                Find something to do
              </Link>
            </p>
          )}
        </TabsContent>
        <TabsContent value="past">
          {past.length ? (
            <List bookings={past} label="Past bookings" />
          ) : (
            <p className="rounded-card border bg-card p-6 text-[15px] text-muted-foreground">
              No past bookings yet. Completed, cancelled and expired bookings appear here.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
