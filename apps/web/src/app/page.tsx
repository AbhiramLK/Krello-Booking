import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

// Placeholder: a later task replaces this with the real home page.
export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 py-16 sm:px-6">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Krello</h1>
        <p className="mt-3 max-w-prose text-lg text-muted-foreground">Booking for courts, studios and spaces is on its way.</p>
      </main>
      <SiteFooter />
    </>
  );
}
