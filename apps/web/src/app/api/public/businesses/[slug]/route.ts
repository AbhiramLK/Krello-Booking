import type { NextRequest } from "next/server";
import { z } from "zod";
import { getPublicBusiness, RESERVED_SLUGS } from "@krello/core";
import { getDb } from "@/lib/db";
import { jsonError, jsonOk, publicHandler } from "@/lib/public-api";

const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);

export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  return publicHandler(async () => {
    const parsed = slugSchema.safeParse((await params).slug);
    if (!parsed.success) return jsonError(400, "bad_request", "That is not a valid venue address.");
    if (RESERVED_SLUGS.has(parsed.data)) return jsonError(404, "not_found", "Venue not found.");
    const business = await getPublicBusiness(getDb(), parsed.data);
    if (!business) return jsonError(404, "not_found", "Venue not found.");
    return jsonOk({ business });
  });
}
