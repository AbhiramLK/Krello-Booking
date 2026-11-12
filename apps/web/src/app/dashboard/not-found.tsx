import Link from "next/link";

/** A booking that does not exist, or is not one this member may open. The dashboard layout supplies the chrome. */
export default function DashboardNotFound() {
  return (
    <div className="flex flex-col items-start py-10">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">We could not find that</h1>
      <p className="mt-3 text-muted-foreground">It may have been removed, or it belongs to a location you do not manage.</p>
      <Link href="/dashboard/bookings" className="mt-6 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90">
        Back to bookings
      </Link>
    </div>
  );
}
