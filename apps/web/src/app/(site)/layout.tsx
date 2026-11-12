import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

/** Chrome for the public marketplace. The root layout renders none, so pages here never repeat it. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-foreground px-4 py-2 text-sm text-background focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
      >
        Skip to content
      </a>
      <SiteHeader />
      {children}
      <SiteFooter />
    </>
  );
}
