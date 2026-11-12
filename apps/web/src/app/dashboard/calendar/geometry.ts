// Pure geometry and slot rules for the calendar grid. No React, no server
// imports. Time runs along a real axis in minutes after local midnight, so
// resources with different slot lengths line up and slots may run past midnight.
import type { SlotView } from "@krello/booking-engine";
import { addDays, dayOfWeek } from "@krello/booking-engine/time";
import { slotBookable, type GridResource } from "../../../components/booking/selection";
import type { BlockView, BookingView, DayView, ResourceView } from "./view-model";

/** Width of one minute on the grid, in pixels (84 px an hour). */
export const PX_PER_MINUTE = 1.4;

export interface Axis {
  /** Whole hours, in minutes after local midnight. */
  start: number;
  end: number;
}

const hourFloor = (m: number) => Math.floor(m / 60) * 60;
const hourCeil = (m: number) => Math.ceil(m / 60) * 60;

/**
 * The span of time the grid covers: every slot, plus any booking or block that
 * overlaps the day, in whole hours. Null when the day has nothing to show.
 * Bookings that began the day before are cut off at midnight.
 */
export function axisOf(day: DayView): Axis | null {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const r of day.resources) {
    for (const s of r.slots) {
      starts.push(s.startMinute);
      ends.push(s.endMinute);
    }
  }
  for (const x of [...day.bookings, ...day.blocks]) {
    starts.push(Math.max(x.startMinute, 0));
    ends.push(x.endMinute);
  }
  if (!starts.length) return null;
  return { start: hourFloor(Math.min(...starts)), end: hourCeil(Math.max(...ends)) };
}

/** Horizontal position of [start, end) on the grid, in pixels from the axis start; null when it falls outside. */
export function place(axis: Axis, startMinute: number, endMinute: number): { left: number; width: number } | null {
  const s = Math.max(startMinute, axis.start);
  const e = Math.min(endMinute, axis.end);
  if (e <= s) return null;
  return { left: (s - axis.start) * PX_PER_MINUTE, width: (e - s) * PX_PER_MINUTE };
}

export const axisWidth = (axis: Axis) => (axis.end - axis.start) * PX_PER_MINUTE;

/** Whole hours along the axis, for the header. */
export function hourTicks(axis: Axis): number[] {
  const out: number[] = [];
  for (let m = axis.start; m < axis.end; m += 60) out.push(m);
  return out;
}

const asGridResource = (r: ResourceView): GridResource => ({
  resourceId: r.id,
  name: r.name,
  bookingMode: r.bookingMode,
  capacity: r.capacity,
  slots: r.slots,
});

/** Slots of `r` that can take `groupSize` people, soonest first. */
export function openSlots(r: ResourceView, groupSize: number): SlotView[] {
  const grid = asGridResource(r);
  return r.slots.filter((s) => slotBookable(grid, s, groupSize)).sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
}

/**
 * Back-to-back open slots from the one starting at `startMinute`: the lengths a
 * booking there can be extended to. The first entry is the slot itself.
 */
export function chainFrom(r: ResourceView, startMinute: number, groupSize: number, limit = 12): SlotView[] {
  const open = openSlots(r, groupSize);
  const chain: SlotView[] = [];
  let at = startMinute;
  while (chain.length < limit) {
    const next = open.find((s) => s.startMinute === at);
    if (!next) break;
    chain.push(next);
    at = next.endMinute;
  }
  return chain;
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

/** Bookings of a shared resource that hold places in the slot, soonest first. */
export function bookingsInSlot(day: DayView, resourceId: string, slot: SlotView): BookingView[] {
  return day.bookings.filter((b) => b.resourceIds.includes(resourceId) && overlaps(b.startMinute, b.endMinute, slot.startMinute, slot.endMinute));
}

/** Places taken in the slot by these bookings. */
export function placesTaken(bookings: BookingView[], resourceId: string): number {
  return bookings.reduce((n, b) => n + (b.items.find((i) => i.resourceId === resourceId)?.units ?? 1), 0);
}

export function blocksInSlot(day: DayView, resourceId: string, slot: SlotView): BlockView[] {
  return day.blocks.filter((b) => b.resourceId === resourceId && overlaps(b.startMinute, b.endMinute, slot.startMinute, slot.endMinute));
}

/** `HH:MM` for a time input, from minutes after midnight (wraps past 24:00). */
export function timeInputValue(minute: number): string {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Minutes after midnight from an `HH:MM` time input value, or null. */
export function parseTimeInput(value: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

export type CalendarView = "day" | "week";

/** The calendar's address for a location, day and view. Nothing about customers goes in it. */
export function calendarHref(p: { location?: string; date?: string; view?: CalendarView }): string {
  const q = new URLSearchParams();
  if (p.location) q.set("location", p.location);
  if (p.date) q.set("date", p.date);
  if (p.view === "week") q.set("view", "week");
  const s = q.toString();
  return s ? `/dashboard/calendar?${s}` : "/dashboard/calendar";
}

/** The Monday on or before a date: where a week view starts. */
export function weekStartOf(date: string): string {
  return addDays(date, -((dayOfWeek(date) + 6) % 7));
}

/** Share of the open time that is booked, 0 to 100, or null when nothing is open. Shared places can add up to more than the whole, so it is capped. */
export function utilisation(day: { bookedMinutes: number; availableMinutes: number }): number | null {
  if (day.availableMinutes <= 0) return null;
  return Math.min(100, Math.round((day.bookedMinutes / day.availableMinutes) * 100));
}
