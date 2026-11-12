"use client";

import { useId, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";

/**
 * Narrows a dashboard page to one location through `?location=`. Renders nothing for a single location.
 * Pass `allowAll={false}` for a page that always shows exactly one location.
 */
export function LocationFilter({ locations, value, allowAll = true }: { locations: { id: string; name: string }[]; value?: string; allowAll?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const id = useId();
  if (locations.length < 2) return null;

  function choose(next: string) {
    const q = new URLSearchParams(params.toString());
    if (next) q.set("location", next);
    else q.delete("location");
    q.delete("page");
    const s = q.toString();
    startTransition(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        Location
      </label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => choose(e.target.value)}
        aria-busy={pending || undefined}
        className="h-10 cursor-pointer appearance-none rounded-full bg-card py-1 pl-4 pr-9 text-sm font-medium shadow-xs ring-1 ring-border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {allowAll && <option value="">All locations</option>}
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    </div>
  );
}
