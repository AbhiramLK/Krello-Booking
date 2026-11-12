// What the calendar's client components receive: plain values only (ISO
// strings and minutes), so the same shape serves the page and the refresh
// endpoint. No server-only imports; `import type` from core is erased.
import type { CalendarDay } from "@krello/core";
import type { SlotView } from "@krello/booking-engine";
import type { BookingStatus } from "@krello/booking-engine/labels";
import { minuteOfDate } from "@krello/booking-engine/time";

export interface ResourceView {
  id: string;
  name: string;
  bookingMode: "exclusive" | "shared";
  capacity: number;
  slots: SlotView[];
}

export interface BookingView {
  id: string;
  reference: string;
  customerName: string;
  status: BookingStatus;
  source: "online" | "phone" | "walk_in" | "admin";
  paymentStatus: "unpaid" | "partially_paid" | "paid";
  startsAt: string;
  endsAt: string;
  /** Minutes after local midnight of the day shown; below 0 when it began the day before. */
  startMinute: number;
  endMinute: number;
  resourceIds: string[];
  groupSize: number;
  customerPhone: string | null;
  totalAmount: number;
  items: { resourceId: string; name: string; units: number }[];
}

export interface BlockView {
  id: string;
  resourceId: string;
  startsAt: string;
  endsAt: string;
  startMinute: number;
  endMinute: number;
  reason: string | null;
}

export interface DayView {
  locationId: string;
  date: string;
  timezone: string;
  resources: ResourceView[];
  bookings: BookingView[];
  blocks: BlockView[];
}

export function toDayView(day: CalendarDay): DayView {
  const minutes = (d: Date) => minuteOfDate(d, day.date, day.timezone);
  return {
    locationId: day.locationId,
    date: day.date,
    timezone: day.timezone,
    resources: day.resources,
    bookings: day.bookings.map((b) => ({
      id: b.id,
      reference: b.reference,
      customerName: b.customerName,
      status: b.status,
      source: b.source,
      paymentStatus: b.paymentStatus,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      startMinute: minutes(b.startsAt),
      endMinute: minutes(b.endsAt),
      resourceIds: b.resourceIds,
      groupSize: b.groupSize,
      customerPhone: b.customerPhone,
      totalAmount: b.totalAmount,
      items: b.items,
    })),
    blocks: day.blocks.map((b) => ({
      id: b.id,
      resourceId: b.resourceId,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      startMinute: minutes(b.startsAt),
      endMinute: minutes(b.endsAt),
      reason: b.reason,
    })),
  };
}
