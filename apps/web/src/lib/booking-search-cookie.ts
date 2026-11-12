/**
 * The remembered bookings search text. It can be a customer's phone number, so
 * it never goes in the address: it lives in an httpOnly cookie scoped to the
 * bookings list instead. The cookie is tied to the signed-in user and the
 * business they were working in, lasts 12 hours, and is cleared when the
 * session starts or ends and when the member switches business.
 *
 * Pure (no `server-only`, no cookie access) so the binding can be tested alone.
 */
export const BOOKING_SEARCH_COOKIE = "krello_booking_q";
export const BOOKING_SEARCH_PATH = "/dashboard/bookings";
export const BOOKING_SEARCH_MAX_AGE_SECONDS = 12 * 60 * 60;

/** User and business ids are UUIDs, so neither can contain the "." or ":" separators. */
const prefix = (userId: string, businessId: string) => `${userId}.${businessId}:`;

/** The cookie value for a search made by this user in this business. */
export function bindSearch(userId: string, businessId: string, q: string): string {
  return `${prefix(userId, businessId)}${q}`;
}

/** The search text, or undefined when the cookie is missing or was set for another user or business. */
export function parseBoundSearch(value: string | undefined, userId: string, businessId: string): string | undefined {
  if (!value) return undefined;
  const p = prefix(userId, businessId);
  if (!value.startsWith(p)) return undefined;
  return value.slice(p.length) || undefined;
}

/** Options shared by setting and deleting, so the delete matches the cookie that was set. */
export const BOOKING_SEARCH_DELETE = { name: BOOKING_SEARCH_COOKIE, path: BOOKING_SEARCH_PATH } as const;
