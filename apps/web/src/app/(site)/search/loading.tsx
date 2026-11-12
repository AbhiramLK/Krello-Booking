import { BusinessCardSkeleton } from "@/components/marketplace/business-card";

export default function SearchLoading() {
  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12" aria-busy="true">
      <div className="h-10 w-56 animate-pulse rounded-full bg-muted" />
      <div className="mt-6 h-16 animate-pulse rounded-full bg-card" />
      <div className="mt-6 flex gap-2">
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className="h-10 w-28 animate-pulse rounded-full bg-muted" />
        ))}
      </div>
      <p role="status" className="sr-only">
        Loading venues
      </p>
      <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((n) => (
          <li key={n}>
            <BusinessCardSkeleton />
          </li>
        ))}
      </ul>
    </main>
  );
}
