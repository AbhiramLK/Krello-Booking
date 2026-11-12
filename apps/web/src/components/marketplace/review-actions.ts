"use server";

import { z } from "zod";
import { listPublicReviews } from "@krello/core";
import { runAction, type ActionResult } from "@/lib/action";
import { getDb } from "@/lib/db";
import { loadPublicBusiness, REVIEWS_PER_PAGE } from "@/lib/public-business";
import type { ReviewItem } from "./review-list";

const loadMoreSchema = z.object({
  slug: z.string().min(1).max(80),
  page: z.number().int().min(2).max(500),
});

/** The next page of reviews for a listed venue. Unlisted or unknown venues give nothing away. */
export async function loadMoreReviewsAction(input: { slug: string; page: number }): Promise<ActionResult<{ reviews: ReviewItem[] }>> {
  return runAction(async () => {
    const { slug, page } = loadMoreSchema.parse(input);
    const business = await loadPublicBusiness(slug);
    if (!business) return { reviews: [] };
    const rows = await listPublicReviews(getDb(), business.id, { page, pageSize: REVIEWS_PER_PAGE });
    return {
      reviews: rows.map((r) => ({
        id: r.id,
        authorName: r.authorName,
        rating: r.rating,
        body: r.body,
        businessResponse: r.businessResponse,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });
}
