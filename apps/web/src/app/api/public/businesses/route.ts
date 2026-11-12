import type { NextRequest } from "next/server";
import { searchBusinesses } from "@krello/core";
import { getDb } from "@/lib/db";
import { jsonOk, publicHandler } from "@/lib/public-api";
import { parseSearchParams, toSearchInput } from "@/lib/search-params";

/** Same query string as `/search`; `maxPrice` is in rupees. Unknown or malformed values fall back to defaults. */
export async function GET(request: NextRequest) {
  return publicHandler(async () => {
    const query = parseSearchParams(Object.fromEntries(request.nextUrl.searchParams));
    const result = await searchBusinesses(getDb(), toSearchInput(query, 12));
    return jsonOk(result);
  });
}
