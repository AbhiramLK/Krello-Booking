import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const linkClass =
  "inline-flex h-10 items-center gap-1 rounded-full border bg-card px-4 text-sm font-medium outline-none transition hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Previous and next links with "Page 2 of 5" between them. Renders nothing for a single page. */
export function Pagination({ page, pages, hrefFor }: { page: number; pages: number; hrefFor: (page: number) => string }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pages" className="mt-10 flex items-center justify-between gap-4">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} rel="prev" className={linkClass}>
          <ChevronLeft className="size-4" aria-hidden="true" />
          Previous
        </Link>
      ) : (
        <span aria-hidden="true" className={cn(linkClass, "invisible")}>
          Previous
        </span>
      )}
      <p className="tabular text-sm text-muted-foreground">
        Page {page} of {pages}
      </p>
      {page < pages ? (
        <Link href={hrefFor(page + 1)} rel="next" className={linkClass}>
          Next
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      ) : (
        <span aria-hidden="true" className={cn(linkClass, "invisible")}>
          Next
        </span>
      )}
    </nav>
  );
}
