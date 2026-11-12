import { describe, expect, it } from "vitest";
import { slotBookingLine } from "./words";
import type { BookingView } from "./view-model";

const booking = (status: BookingView["status"]): BookingView => ({
  id: "b",
  reference: "KR-X",
  customerName: "Asha",
  status,
  source: "walk_in",
  paymentStatus: "unpaid",
  startsAt: "2030-01-01T12:30:00.000Z",
  endsAt: "2030-01-01T13:30:00.000Z",
  startMinute: 18 * 60,
  endMinute: 19 * 60,
  resourceIds: ["s"],
  groupSize: 3,
  customerPhone: null,
  totalAmount: 0,
  items: [{ resourceId: "s", name: "Open swim", units: 3 }],
});

describe("slotBookingLine", () => {
  it("gives each status its own word, never Confirmed for one that is not", () => {
    const line = (s: BookingView["status"]) => slotBookingLine(booking(s), "s", "Asia/Kolkata");
    expect(line("approved")).toBe("3 places · 6:00 PM – 7:00 PM · Confirmed");
    expect(line("pending")).toContain("Pending");
    expect(line("expired")).toContain("Expired");
    expect(line("expired")).not.toContain("Confirmed");
    expect(line("completed")).toContain("Completed");
    expect(line("no_show")).toContain("No-show");
    for (const s of ["pending", "expired", "completed", "no_show"] as const) expect(line(s)).not.toContain("Confirmed");
  });

  it("counts a single place as one place", () => {
    const b = { ...booking("approved"), items: [{ resourceId: "s", name: "Open swim", units: 1 }] };
    expect(slotBookingLine(b, "s", "Asia/Kolkata")).toMatch(/^1 place · /);
  });
});
