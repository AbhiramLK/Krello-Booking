import { addDays, isValidDate, localDateOf, localToInstant } from "@krello/booking-engine/time";

// The period the payments page reports on, as local calendar days at the
// venue. Pure, so it can be tested without a server: the page passes the
// location's timezone and the current time.

export const RANGE_KEYS = ["today", "7d", "30d", "custom"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export const RANGE_LABEL: Record<RangeKey, string> = { today: "Today", "7d": "7 days", "30d": "30 days", custom: "Custom" };

/** The longest custom period, so one page never sums years of bookings. */
export const MAX_CUSTOM_DAYS = 366;

export interface ResolvedRange {
  key: RangeKey;
  /** First local day, `YYYY-MM-DD`. */
  fromDate: string;
  /** Last local day, inclusive. */
  toDate: string;
  /** Start of the first day. */
  from: Date;
  /** Start of the day after the last day: an exclusive end. */
  to: Date;
  /** Set when the custom dates could not be used and today is shown instead. */
  notice?: string;
}

const PRESET_DAYS: Record<"today" | "7d" | "30d", number> = { today: 1, "7d": 7, "30d": 30 };

function build(key: RangeKey, fromDate: string, toDate: string, tz: string, notice?: string): ResolvedRange {
  return {
    key,
    fromDate,
    toDate,
    from: localToInstant(fromDate, 0, tz),
    to: localToInstant(addDays(toDate, 1), 0, tz),
    ...(notice ? { notice } : {}),
  };
}

/**
 * Today, the last 7 days (today and the six before it), the last 30 days, or
 * custom dates. An unusable custom range falls back to today with a notice.
 */
export function resolveRange(input: { range?: RangeKey; from?: string; to?: string }, tz: string, now: Date): ResolvedRange {
  const today = localDateOf(now, tz);
  const key = input.range ?? "today";
  if (key !== "custom") return build(key, addDays(today, 1 - PRESET_DAYS[key]), today, tz);

  const fallback = (notice: string) => build("today", today, today, tz, notice);
  if (!input.from || !input.to) return fallback("Choose both a start and an end date. Showing today.");
  if (!isValidDate(input.from) || !isValidDate(input.to)) return fallback("Those dates are not valid. Showing today.");
  if (input.to < input.from) return fallback("The end date is before the start date. Showing today.");
  if (localToInstant(addDays(input.to, 1), 0, tz).getTime() - localToInstant(input.from, 0, tz).getTime() > MAX_CUSTOM_DAYS * 86_400_000) {
    return fallback(`Choose a period of up to ${MAX_CUSTOM_DAYS} days. Showing today.`);
  }
  return build("custom", input.from, input.to, tz);
}
