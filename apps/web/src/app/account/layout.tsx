import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { AccountNav } from "./account-nav";

// Private pages: kept out of search results and, in robots.ts, out of crawling.
export const metadata: Metadata = {
  title: "My account",
  robots: { index: false, follow: false },
};

/**
 * Chrome for the signed-in customer's pages. Each page calls `requireUser` with its
 * own path, because a layout does not know which page it is wrapping.
 */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-foreground px-4 py-2 text-sm text-background focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <AccountNav />
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
