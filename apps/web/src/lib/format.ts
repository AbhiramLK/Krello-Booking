// Display formatting shared by server components, client components and tests.
// Keep this file free of Next.js and server-only imports.
import { formatInr } from "@krello/pricing";

export { formatInr };

type DateInput = Date | string;

function toDate(d: DateInput): Date {
  return typeof d === "string" ? new Date(d) : d;
}

/** Reads parts through Intl so output does not depend on the ICU version's spacing. */
function parts(d: DateInput, tz: string, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", { ...options, timeZone: tz }).formatToParts(toDate(d))) {
    out[p.type] = p.value;
  }
  return out;
}

function clock(hour24: number, minute: number): string {
  const h = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${h}:${String(minute).padStart(2, "0")} ${hour24 % 24 < 12 ? "AM" : "PM"}`;
}

/** `7:30 PM` in the given IANA timezone. */
export function formatTime(d: DateInput, tz: string): string {
  const p = parts(d, tz, { hour: "numeric", minute: "numeric", hourCycle: "h23" });
  return clock(Number(p.hour) % 24, Number(p.minute));
}

/** `Sat, 14 Nov` in the given IANA timezone. */
export function formatDay(d: DateInput, tz: string): string {
  const p = parts(d, tz, { weekday: "short", day: "numeric", month: "short" });
  return `${p.weekday}, ${p.day} ${p.month}`;
}

/** `Saturday, 14 November 2026` from a `YYYY-MM-DD` calendar date. */
export function formatDayLong(date: string): string {
  const p = parts(`${date}T12:00:00Z`, "UTC", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
}

/** `Sat, 14 Nov · 7:30 PM – 9:00 PM` */
export function formatRange(start: DateInput, end: DateInput, tz: string): string {
  return `${formatDay(start, tz)} · ${formatTime(start, tz)} – ${formatTime(end, tz)}`;
}

/** `7:30 PM` from minutes after local midnight. Values of 1440 and over wrap to the next day. */
export function minuteLabel(minute: number): string {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  return clock(Math.floor(m / 60), m % 60);
}

/** `12 min left`, `1 h 05 min left` or `Expired`. */
export function countdown(to: Date, now: Date): string {
  const ms = to.getTime() - now.getTime();
  if (ms <= 0) return "Expired";
  // Floor so "12 min 20 s" reads as 12; never show 0 while time remains.
  const whole = Math.max(1, Math.floor(ms / 60_000));
  if (whole < 60) return `${whole} min left`;
  return `${Math.floor(whole / 60)} h ${String(whole % 60).padStart(2, "0")} min left`;
}

/** `Nov 2026` in the given IANA timezone. */
export function formatMonthYear(d: DateInput, tz: string): string {
  const p = parts(d, tz, { month: "short", year: "numeric" });
  return `${p.month} ${p.year}`;
}

/**
 * `from ₹200 per hour`, `from ₹150 per slot`, `from ₹150 per person per slot`.
 * `paise` is the amount for one price unit; returns null when nothing is priced yet.
 */
export function priceLabel(paise: number | null, unit: "per_hour" | "per_slot" | null, perPerson: boolean | null): string | null {
  if (paise === null || unit === null) return null;
  return `from ${formatInr(paise)} ${perPerson ? "per person " : ""}${unit === "per_hour" ? "per hour" : "per slot"}`;
}

/** `India Standard Time` for the given IANA timezone at that moment. */
export function timeZoneName(d: DateInput, tz: string): string {
  return parts(d, tz, { timeZoneName: "long" }).timeZoneName ?? tz;
}

/** `30 minutes`, `1 hour`, `2 hours`, `1 h 30 min`. */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} hour${h === 1 ? "" : "s"}`;
}

/** `Mon 16 Nov` from a `YYYY-MM-DD` calendar date. */
export function formatDateShort(date: string): string {
  const p = parts(`${date}T12:00:00Z`, "UTC", { weekday: "short", day: "numeric", month: "short" });
  return `${p.weekday} ${p.day} ${p.month}`;
}
