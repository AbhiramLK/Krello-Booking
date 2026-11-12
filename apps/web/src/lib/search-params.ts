// Reads and writes the marketplace search URL. Pure and client-safe: no database or server imports.
// Everything in a query string is untrusted, so parsing never throws and always lands on a safe value.

export const SORTS = ["relevance", "price_asc", "price_desc", "rating"] as const;
export type SearchSort = (typeof SORTS)[number];

export const SORT_LABEL: Record<SearchSort, string> = {
  relevance: "Relevance",
  price_asc: "Price, low to high",
  price_desc: "Price, high to low",
  rating: "Top rated",
};

export const MAX_PAGE = 500;
const TEXT_MAX = 80;

/** What the page and its filters work with. `maxPrice` is in whole rupees, as in the URL. */
export interface SearchQuery {
  q: string;
  category: string;
  city: string;
  sort: SearchSort;
  /** 0 means no minimum. Half steps up to 5. */
  minRating: number;
  /** Whole rupees, 0 means no ceiling. */
  maxPrice: number;
  page: number;
}

export type RawParams = Record<string, string | string[] | undefined>;

export const EMPTY_QUERY: SearchQuery = { q: "", category: "", city: "", sort: "relevance", minRating: 0, maxPrice: 0, page: 1 };

/** Repeated keys (`?q=a&q=b`) arrive as arrays; the first one wins. */
function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function text(value: string | string[] | undefined): string {
  return first(value).replace(/\s+/g, " ").trim().slice(0, TEXT_MAX);
}

function wholeNumber(value: string | string[] | undefined, min: number, max: number, fallback: number): number {
  const raw = first(value).trim();
  if (!/^\d{1,9}$/.test(raw)) return fallback;
  return Math.min(max, Math.max(min, Number(raw)));
}

export function parseSearchParams(raw: RawParams): SearchQuery {
  const category = text(raw.category).toLowerCase();
  const sort = first(raw.sort);
  const rating = Number.parseFloat(first(raw.minRating));
  return {
    q: text(raw.q),
    category: /^[a-z0-9][a-z0-9-]{0,59}$/.test(category) ? category : "",
    city: text(raw.city),
    sort: (SORTS as readonly string[]).includes(sort) ? (sort as SearchSort) : "relevance",
    minRating: Number.isFinite(rating) && rating > 0 ? Math.min(5, Math.round(rating * 2) / 2) : 0,
    maxPrice: wholeNumber(raw.maxPrice, 0, 1_000_000, 0),
    page: wholeNumber(raw.page, 1, MAX_PAGE, 1),
  };
}

/** Converts the URL's rupees to the paise `searchBusinesses` expects. This is the only place it happens. */
export function toSearchInput(query: SearchQuery, pageSize?: number) {
  return {
    q: query.q || undefined,
    category: query.category || undefined,
    city: query.city || undefined,
    sort: query.sort,
    minRating: query.minRating || undefined,
    maxPrice: query.maxPrice ? query.maxPrice * 100 : undefined,
    page: query.page,
    pageSize,
  };
}

/** True when anything narrows the results (the page number does not count). */
export function hasFilters(query: SearchQuery): boolean {
  return Boolean(query.q || query.category || query.city || query.minRating || query.maxPrice || query.sort !== "relevance");
}

/**
 * `/search?...` for a query with some fields changed. Defaults are left out so URLs stay short,
 * and the page resets to 1 unless the change sets it.
 */
export function searchHref(query: SearchQuery, patch: Partial<SearchQuery> = {}, base = "/search"): string {
  const next: SearchQuery = { ...query, page: 1, ...patch };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.category) params.set("category", next.category);
  if (next.city) params.set("city", next.city);
  if (next.sort !== "relevance") params.set("sort", next.sort);
  if (next.minRating) params.set("minRating", String(next.minRating));
  if (next.maxPrice) params.set("maxPrice", String(next.maxPrice));
  if (next.page > 1) params.set("page", String(next.page));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
