import { describe, expect, it } from "vitest";
import { EMPTY_QUERY, hasFilters, pageCount, parseSearchParams, searchHref, toSearchInput } from "./search-params";

describe("parseSearchParams", () => {
  it("returns defaults for an empty query string", () => {
    expect(parseSearchParams({})).toEqual(EMPTY_QUERY);
  });

  it("reads valid values", () => {
    expect(
      parseSearchParams({ q: "  snooker  table ", category: "Snooker-Pool", city: "Indiranagar", sort: "price_asc", minRating: "4", maxPrice: "500", page: "3" }),
    ).toEqual({ q: "snooker table", category: "snooker-pool", city: "Indiranagar", sort: "price_asc", minRating: 4, maxPrice: 500, page: 3 });
  });

  it("ignores unknown sorts and malformed categories", () => {
    expect(parseSearchParams({ sort: "random; drop table" }).sort).toBe("relevance");
    expect(parseSearchParams({ category: "x'; --" }).category).toBe("");
    expect(parseSearchParams({ category: "../etc" }).category).toBe("");
  });

  it("clamps the page and parses numbers safely", () => {
    expect(parseSearchParams({ page: "-4" }).page).toBe(1);
    expect(parseSearchParams({ page: "0" }).page).toBe(1);
    expect(parseSearchParams({ page: "abc" }).page).toBe(1);
    expect(parseSearchParams({ page: "1.5" }).page).toBe(1);
    expect(parseSearchParams({ page: "999999999" }).page).toBe(500);
    expect(parseSearchParams({ maxPrice: "-5" }).maxPrice).toBe(0);
    expect(parseSearchParams({ maxPrice: "1e9" }).maxPrice).toBe(0);
    expect(parseSearchParams({ maxPrice: "99999999" }).maxPrice).toBe(1_000_000);
    expect(parseSearchParams({ minRating: "9" }).minRating).toBe(5);
    expect(parseSearchParams({ minRating: "NaN" }).minRating).toBe(0);
    expect(parseSearchParams({ minRating: "-1" }).minRating).toBe(0);
    expect(parseSearchParams({ minRating: "3.7" }).minRating).toBe(3.5);
  });

  it("takes the first of repeated keys and caps text length", () => {
    expect(parseSearchParams({ q: ["first", "second"] }).q).toBe("first");
    expect(parseSearchParams({ q: "x".repeat(500) }).q).toHaveLength(80);
  });
});

describe("toSearchInput", () => {
  it("converts rupees to paise and drops empty fields", () => {
    expect(toSearchInput({ ...EMPTY_QUERY, maxPrice: 250, q: "pool" })).toMatchObject({ q: "pool", maxPrice: 25000, category: undefined, minRating: undefined });
    expect(toSearchInput(EMPTY_QUERY).maxPrice).toBeUndefined();
  });
});

describe("searchHref", () => {
  it("omits defaults", () => {
    expect(searchHref(EMPTY_QUERY)).toBe("/search");
  });

  it("round-trips through parseSearchParams", () => {
    const query = { q: "five a side", category: "football-turf", city: "HSR Layout", sort: "rating" as const, minRating: 4.5, maxPrice: 1200, page: 2 };
    const url = new URL(searchHref(query, { page: 2 }), "http://x");
    expect(parseSearchParams(Object.fromEntries(url.searchParams))).toEqual(query);
  });

  it("resets the page when a filter changes, unless the patch sets it", () => {
    const query = { ...EMPTY_QUERY, q: "pool", page: 4 };
    expect(searchHref(query, { sort: "rating" })).toBe("/search?q=pool&sort=rating");
    expect(searchHref(query, { page: 5 })).toBe("/search?q=pool&page=5");
  });

  it("encodes text and supports another base path", () => {
    expect(searchHref(EMPTY_QUERY, { q: "a&b=c" }, "/c/swimming")).toBe("/c/swimming?q=a%26b%3Dc");
  });
});

describe("hasFilters and pageCount", () => {
  it("ignores the page number", () => {
    expect(hasFilters({ ...EMPTY_QUERY, page: 3 })).toBe(false);
    expect(hasFilters({ ...EMPTY_QUERY, sort: "rating" })).toBe(true);
    expect(hasFilters({ ...EMPTY_QUERY, city: "Indiranagar" })).toBe(true);
  });

  it("counts at least one page", () => {
    expect(pageCount(0, 12)).toBe(1);
    expect(pageCount(13, 12)).toBe(2);
  });
});
