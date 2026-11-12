import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** `4.6 (38)` with one star, or "New" when nobody has reviewed the venue yet. */
export function RatingSummary({ rating, count, className, long = false }: { rating: number | null; count: number; className?: string; long?: boolean }) {
  if (rating === null || count === 0) {
    return <span className={cn("text-sm text-muted-foreground", className)}>New on Krello</span>;
  }
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm tabular", className)}>
      <Star className="size-3.5 fill-[#ff9f0a] text-[#ff9f0a]" aria-hidden="true" />
      <span className="font-medium">{rating.toFixed(1)}</span>
      <span className="text-muted-foreground">
        ({count}
        {long ? (count === 1 ? " review" : " reviews") : ""})
      </span>
      <span className="sr-only">
        Rated {rating.toFixed(1)} out of 5 from {count} {count === 1 ? "review" : "reviews"}
      </span>
    </span>
  );
}

/** Five stars for one review. The number is in the label, so colour is never the only signal. */
export function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} role="img" aria-label={`Rated ${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn("size-4", n <= value ? "fill-[#ff9f0a] text-[#ff9f0a]" : "fill-transparent text-black/20")} aria-hidden="true" />
      ))}
    </span>
  );
}
