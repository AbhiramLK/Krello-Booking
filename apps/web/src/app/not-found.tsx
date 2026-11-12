import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start justify-center px-4 py-16 sm:px-6">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">We could not find that page</h1>
        <p className="mt-3 text-muted-foreground">The link may be old, or the page may have moved.</p>
        <Link
          href="/"
          className="mt-6 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Back to home
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
