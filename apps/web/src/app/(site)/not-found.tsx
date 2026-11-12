import Link from "next/link";

/** Shown for an unknown or unlisted venue or category. The (site) layout already supplies the header and footer. */
export default function SiteNotFound() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start justify-center px-4 py-16 sm:px-6">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">We could not find that page</h1>
      <p className="mt-3 text-muted-foreground">The link may be old, or the venue may no longer take bookings through Krello.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/search" className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90">
          Find a venue
        </Link>
        <Link href="/" className="rounded-full border bg-card px-5 py-2.5 text-sm font-medium hover:bg-muted">
          Back to home
        </Link>
      </div>
    </main>
  );
}
