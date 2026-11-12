import { MapPin, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  q?: string;
  city?: string;
  /** Other active filters, carried through so searching again does not drop them. */
  hidden?: Record<string, string | number | undefined>;
  className?: string;
  /** Form action. Defaults to the search page. */
  action?: string;
}

/**
 * A plain GET form: it works before any script loads, and the result is a shareable `/search?...` URL.
 */
export function SearchBar({ q = "", city = "", hidden = {}, className, action = "/search" }: SearchBarProps) {
  return (
    <form
      action={action}
      role="search"
      className={cn(
        "flex w-full flex-col gap-1 rounded-[26px] border bg-card p-2 shadow-[0_8px_30px_-14px_rgba(0,0,0,0.18)] focus-within:border-ring/60 sm:flex-row sm:items-center sm:rounded-full",
        className,
      )}
    >
      {Object.entries(hidden).map(([name, value]) =>
        value === undefined || value === "" || value === 0 ? null : <input key={name} type="hidden" name={name} value={value} />,
      )}
      <label className="flex min-w-0 flex-1 items-center gap-3 rounded-full px-4 py-2.5 sm:py-2">
        <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">What do you want to book</span>
        <input
          name="q"
          type="search"
          defaultValue={q}
          maxLength={80}
          placeholder="Snooker, swimming"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
      </label>
      <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-border sm:block" />
      <label className="flex min-w-0 items-center gap-3 rounded-full px-4 py-2.5 sm:w-56 sm:py-2">
        <MapPin className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Area or city</span>
        <input
          name="city"
          type="text"
          defaultValue={city}
          maxLength={80}
          placeholder="Area or city"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
      </label>
      <button
        type="submit"
        className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground outline-none transition hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.98]"
      >
        Search
      </button>
    </form>
  );
}
