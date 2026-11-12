"use client";

import { useState, useTransition } from "react";
import { formatMonthYear } from "@/lib/format";
import { Stars } from "./rating";
import { loadMoreReviewsAction } from "./review-actions";

export interface ReviewItem {
  id: string;
  authorName: string;
  rating: number;
  body: string | null;
  businessResponse: string | null;
  /** ISO timestamp. */
  createdAt: string;
}

interface ReviewListProps {
  slug: string;
  timezone: string;
  initial: ReviewItem[];
  /** Visible reviews for the whole venue. */
  total: number;
  pageSize: number;
}

export function ReviewList({ slug, timezone, initial, total, pageSize }: ReviewListProps) {
  const [reviews, setReviews] = useState(initial);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, startTransition] = useTransition();
  const hasMore = reviews.length < total && page * pageSize <= reviews.length;

  if (initial.length === 0) {
    return (
      <p className="rounded-2xl bg-muted/60 px-5 py-6 text-sm text-muted-foreground">
        No reviews yet. Reviews appear here after guests have visited.
      </p>
    );
  }

  const showMore = () =>
    startTransition(async () => {
      setError(null);
      const result = await loadMoreReviewsAction({ slug, page: page + 1 });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setReviews((current) => {
        const seen = new Set(current.map((r) => r.id));
        return [...current, ...result.data.reviews.filter((r) => !seen.has(r.id))];
      });
      setPage((p) => p + 1);
    });

  return (
    <div>
      <ul className="divide-y">
        {reviews.map((review) => (
          <li key={review.id} className="py-5 first:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <p className="font-medium">{review.authorName}</p>
              <p className="text-sm text-muted-foreground">{formatMonthYear(review.createdAt, timezone)}</p>
            </div>
            <Stars value={review.rating} className="mt-1" />
            {review.body && <p className="mt-2 max-w-[65ch] text-[15px] leading-relaxed">{review.body}</p>}
            {review.businessResponse && (
              <div className="mt-3 max-w-[65ch] rounded-xl bg-muted/60 px-4 py-3 text-sm">
                <p className="font-medium">Response from the venue</p>
                <p className="mt-1 leading-relaxed text-muted-foreground">{review.businessResponse}</p>
              </div>
            )}
          </li>
        ))}
      </ul>

      <p role="status" className="sr-only">
        Showing {reviews.length} of {total} reviews
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {hasMore && (
        <button
          type="button"
          onClick={showMore}
          disabled={loading}
          className="mt-4 inline-flex h-10 items-center rounded-full border bg-card px-5 text-sm font-medium outline-none transition hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
        >
          {loading ? "Loading" : "Show more"}
        </button>
      )}
    </div>
  );
}
