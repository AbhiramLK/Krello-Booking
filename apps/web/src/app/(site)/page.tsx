import Link from "next/link";
import { ArrowRight, BadgeCheck, CalendarCheck, Send, Wallet } from "lucide-react";
import { listCategories, searchBusinesses } from "@krello/core";
import { BusinessCard } from "@/components/marketplace/business-card";
import { CategoryTiles } from "@/components/marketplace/category-tiles";
import { SearchBar } from "@/components/marketplace/search-bar";
import { getDb } from "@/lib/db";

export const metadata = {
  title: { absolute: "Krello: book courts, tables and lanes near you" },
  description: "See what is free at local venues, send a booking request, and pay at the venue.",
  alternates: { canonical: "/" },
};

const STEPS = [
  { Icon: CalendarCheck, title: "See what is free", text: "Pick a venue and a day. Open slots are listed as they stand." },
  { Icon: Send, title: "Request your slot", text: "Choose a time and send your request. Nothing is charged online." },
  { Icon: BadgeCheck, title: "Venue confirms", text: "The venue accepts or declines. Your slot is held while it decides." },
  { Icon: Wallet, title: "Pay at the venue", text: "Settle up in person when you arrive." },
];

export default async function HomePage() {
  const db = getDb();
  const [categories, popular] = await Promise.all([listCategories(db), searchBusinesses(db, { sort: "rating", pageSize: 6 })]);

  return (
    <main id="main" className="flex-1">
      <section className="mx-auto grid w-full max-w-6xl gap-10 px-4 pb-12 pt-10 sm:px-6 sm:pb-16 sm:pt-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center lg:gap-14">
        <div>
          <h1 className="max-w-[16ch] text-4xl font-semibold leading-[1.05] tracking-tighter sm:text-5xl lg:text-6xl">Book a table, a lane or a court.</h1>
          <p className="mt-5 max-w-[52ch] text-lg leading-relaxed text-muted-foreground">
            See what is free, send a request, and pay at the venue.
          </p>
          <SearchBar className="mt-8" />
        </div>
        <CategoryTiles categories={categories.slice(0, 5)} />
      </section>

      <section aria-labelledby="popular" className="mx-auto w-full max-w-6xl px-4 pb-14 sm:px-6 sm:pb-20">
        <div className="flex items-end justify-between gap-4">
          <h2 id="popular" className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Popular near you
          </h2>
          <Link href="/search" className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
            See all venues
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
        {popular.items.length === 0 ? (
          <p className="mt-6 rounded-card border bg-card px-6 py-10 text-center text-muted-foreground">No venues are open for booking yet. Please check back soon.</p>
        ) : (
          <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {popular.items.map((business) => (
              <li key={business.id}>
                <BusinessCard business={business} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="how" className="mx-auto w-full max-w-6xl px-4 pb-14 sm:px-6 sm:pb-20">
        <div className="grid gap-8 rounded-[28px] bg-card p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.06] sm:p-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-14">
          <div>
            <h2 id="how" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              How it works
            </h2>
            <p className="mt-3 max-w-[36ch] text-muted-foreground">Four steps from browsing to playing. You never pay online.</p>
          </div>
          <ol className="relative grid gap-6">
            {STEPS.map(({ Icon, title, text }, i) => (
              <li key={title} className="relative flex gap-4">
                {i < STEPS.length - 1 && <span aria-hidden="true" className="absolute left-5 top-11 -bottom-6 w-px bg-border" />}
                <span className="relative inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e5f0fc] text-[#0058b0]">
                  <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
                </span>
                <div className="pt-1.5">
                  <h3 className="font-semibold leading-tight">{title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="owners" className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24">
        <div className="flex flex-col gap-6 rounded-[28px] bg-[#e5f0fc] p-6 sm:flex-row sm:items-center sm:justify-between sm:p-10">
          <div>
            <h2 id="owners" className="text-2xl font-semibold tracking-tight text-[#003a75] sm:text-3xl">
              Run a venue?
            </h2>
            <p className="mt-2 max-w-[48ch] text-[#2c4f78]">Take booking requests online, keep one calendar for walk-ins and calls, and see who is coming.</p>
          </div>
          <Link
            href="/login?next=/dashboard"
            className="inline-flex h-12 shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-primary px-7 text-base font-medium text-primary-foreground outline-none transition hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.98]"
          >
            List your venue
          </Link>
        </div>
      </section>
    </main>
  );
}
