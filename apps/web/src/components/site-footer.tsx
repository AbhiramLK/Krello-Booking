import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>Krello. Book courts, studios and spaces.</p>
        <nav aria-label="Footer" className="flex gap-4">
          <Link href="/search" className="hover:text-foreground">
            Find a venue
          </Link>
          <Link href="/login?next=/dashboard" className="hover:text-foreground">
            For business
          </Link>
          <Link href="/login" className="hover:text-foreground">
            Sign in
          </Link>
        </nav>
      </div>
    </footer>
  );
}
