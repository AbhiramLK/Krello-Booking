import { describe, expect, it } from "vitest";
import type { SlotView } from "@krello/booking-engine";
import { axisOf, bookingsInSlot, calendarHref, chainFrom, parseTimeInput, PX_PER_MINUTE, place, placesTaken, timeInputValue, utilisation, weekStartOf } from "./geometry";
import type { BookingView, DayView, ResourceView } from "./view-model";

const slot = (startMinute: number, endMinute: number, state: SlotView["state"] = "available", remaining = 1): SlotView => ({
  startsAt: "",
  endsAt: "",
  startMinute,
  endMinute,
  state,
  remaining,
  price: 30000,
});

const hourly = (from: number, to: number, taken: number[] = []) =>
  Array.from({ length: (to - from) / 60 }, (_, i) => slot(from + i * 60, from + (i + 1) * 60, taken.includes(from + i * 60) ? "confirmed" : "available", taken.includes(from + i * 60) ? 0 : 1));

const table = (id: string, slots: SlotView[]): ResourceView => ({ id, name: id, bookingMode: "exclusive", capacity: 4, slots });

const booking = (over: Partial<BookingView> & Pick<BookingView, "startMinute" | "endMinute">): BookingView => ({
  id: "b",
  reference: "KR-X",
  customerName: "Asha",
  status: "approved",
  source: "phone",
  paymentStatus: "unpaid",
  startsAt: "",
  endsAt: "",
  resourceIds: ["t1"],
  groupSize: 2,
  customerPhone: null,
  totalAmount: 0,
  items: [{ resourceId: "t1", name: "t1", units: 1 }],
  ...over,
});

const day = (resources: ResourceView[], bookings: BookingView[] = []): DayView => ({
  locationId: "l",
  date: "2030-01-01",
  timezone: "Asia/Kolkata",
  resources,
  bookings,
  blocks: [],
});

describe("axisOf", () => {
  it("spans every resource's slots in whole hours, whatever their lengths", () => {
    // Tables run 10:00-22:00 in hours; the VIP table 10:30-22:30 in 90-minute slots.
    const vip = table("vip", [slot(10 * 60 + 30, 12 * 60), slot(12 * 60, 13 * 60 + 30), slot(21 * 60, 22 * 60 + 30)]);
    expect(axisOf(day([table("t1", hourly(10 * 60, 22 * 60)), vip]))).toEqual({ start: 10 * 60, end: 23 * 60 });
  });

  it("extends past midnight for a late slot", () => {
    expect(axisOf(day([table("t1", [slot(23 * 60, 25 * 60)])]))).toEqual({ start: 23 * 60, end: 25 * 60 });
  });

  it("includes a booking outside the slots, cut off at midnight", () => {
    const d = day([table("t1", hourly(10 * 60, 12 * 60))], [booking({ startMinute: -90, endMinute: 30 })]);
    expect(axisOf(d)).toEqual({ start: 0, end: 12 * 60 });
  });

  it("is null for a day with nothing on it", () => {
    expect(axisOf(day([table("t1", [])]))).toBeNull();
  });
});

describe("place", () => {
  const axis = { start: 10 * 60, end: 22 * 60 };

  it("positions by minutes, so a 90-minute booking is half as wide again as an hour", () => {
    const hour = place(axis, 11 * 60, 12 * 60)!;
    const long = place(axis, 11 * 60, 12 * 60 + 30)!;
    expect(hour).toEqual({ left: 60 * PX_PER_MINUTE, width: 60 * PX_PER_MINUTE });
    expect(long.width).toBeCloseTo(hour.width * 1.5);
    expect(place(axis, 10 * 60, 11 * 60)!.left).toBe(0);
  });

  it("clips to the axis and drops what is outside it", () => {
    expect(place(axis, 9 * 60, 11 * 60)).toEqual({ left: 0, width: 60 * PX_PER_MINUTE });
    expect(place(axis, 21 * 60, 23 * 60)).toEqual({ left: 11 * 60 * PX_PER_MINUTE, width: 60 * PX_PER_MINUTE });
    expect(place(axis, 6 * 60, 8 * 60)).toBeNull();
    expect(place(axis, 22 * 60, 23 * 60)).toBeNull();
  });
});

describe("chainFrom", () => {
  it("lists the lengths a booking can be extended to, stopping at a taken slot", () => {
    const t = table("t1", hourly(10 * 60, 16 * 60, [13 * 60]));
    expect(chainFrom(t, 10 * 60, 2).map((s) => s.startMinute)).toEqual([10 * 60, 11 * 60, 12 * 60]);
    expect(chainFrom(t, 14 * 60, 2).map((s) => s.startMinute)).toEqual([14 * 60, 15 * 60]);
    expect(chainFrom(t, 13 * 60, 2)).toEqual([]);
  });

  it("follows 90-minute slots end to end", () => {
    const vip = table("vip", [slot(600, 690), slot(690, 780), slot(780, 870)]);
    expect(chainFrom(vip, 600, 2).map((s) => s.endMinute)).toEqual([690, 780, 870]);
  });

  it("needs places for the whole group on a shared resource", () => {
    const swim: ResourceView = { id: "s", name: "Swim", bookingMode: "shared", capacity: 10, slots: [slot(600, 660, "available", 6), slot(660, 720, "available", 2)] };
    expect(chainFrom(swim, 600, 4).length).toBe(1);
    expect(chainFrom(swim, 600, 2).length).toBe(2);
  });
});

describe("shared slots", () => {
  it("counts the places the bookings in a slot take", () => {
    const swim: ResourceView = { id: "s", name: "Swim", bookingMode: "shared", capacity: 10, slots: [slot(600, 660), slot(660, 720)] };
    const mine = (id: string, startMinute: number, units: number) =>
      booking({ id, startMinute, endMinute: startMinute + 60, resourceIds: ["s"], items: [{ resourceId: "s", name: "Swim", units }] });
    const d = day([swim], [mine("a", 600, 3), mine("b", 600, 4), mine("c", 660, 2)]);
    const here = bookingsInSlot(d, "s", swim.slots[0]!);
    expect(here.map((b) => b.id)).toEqual(["a", "b"]);
    expect(placesTaken(here, "s")).toBe(7);
  });
});

describe("time inputs", () => {
  it("round-trips HH:MM", () => {
    expect(timeInputValue(9 * 60 + 5)).toBe("09:05");
    expect(parseTimeInput("09:05")).toBe(545);
    expect(parseTimeInput("24:00")).toBeNull();
    expect(parseTimeInput("")).toBeNull();
  });
});

describe("week", () => {
  it("starts on Monday", () => {
    expect(weekStartOf("2026-11-12")).toBe("2026-11-09"); // a Thursday
    expect(weekStartOf("2026-11-09")).toBe("2026-11-09");
    expect(weekStartOf("2026-11-15")).toBe("2026-11-09"); // the Sunday closing that week
    expect(weekStartOf("2026-11-16")).toBe("2026-11-16");
  });

  it("caps utilisation at the whole and says nothing for a day with nothing open", () => {
    expect(utilisation({ bookedMinutes: 60, availableMinutes: 240 })).toBe(25);
    expect(utilisation({ bookedMinutes: 500, availableMinutes: 240 })).toBe(100);
    expect(utilisation({ bookedMinutes: 0, availableMinutes: 0 })).toBeNull();
  });
});

describe("calendarHref", () => {
  it("keeps only the location, date and view, never customer details", () => {
    expect(calendarHref({})).toBe("/dashboard/calendar");
    expect(calendarHref({ location: "L", date: "2030-01-01", view: "week" })).toBe("/dashboard/calendar?location=L&date=2030-01-01&view=week");
    expect(calendarHref({ location: "L", date: "2030-01-01", view: "day" })).toBe("/dashboard/calendar?location=L&date=2030-01-01");
  });
});
