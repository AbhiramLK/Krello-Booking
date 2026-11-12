import Link from "next/link";

const NAV = [
  { href: "/search", label: "Find a venue" },
  { href: "/for-business", label: "For business" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="rounded-md text-lg font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4">
          Krello
        </Link>
        {/* Secondary links collapse into the footer below sm so the header fits 360 px. */}
        <nav aria-label="Main" className="flex items-center gap-1 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="hidden whitespace-nowrap rounded-full px-3 py-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 sm:inline-block"
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/login"
            className="whitespace-nowrap rounded-full bg-primary px-4 py-2 font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}
