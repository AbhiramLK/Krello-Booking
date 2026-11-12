import { describe, expect, it } from "vitest";
import { countdown, formatDay, formatDayLong, formatInr, formatMonthYear, formatRange, formatTime, minuteLabel, priceLabel } from "./format";

const tz = "Asia/Kolkata";

describe("format", () => {
  it("formats a time in the venue timezone", () => {
    expect(formatTime("2026-11-14T14:00:00Z", tz)).toBe("7:30 PM");
  });

  it("formats a short day", () => {
    expect(formatDay("2026-11-14T14:00:00Z", tz)).toBe("Sat, 14 Nov");
  });

  it("abbreviates September as Sep", () => {
    expect(formatDay("2026-09-05T14:00:00Z", tz)).toBe("Sat, 5 Sep");
    expect(formatDayLong("2026-09-05")).toBe("Saturday, 5 September 2026");
  });

  it("formats a long day from a calendar date", () => {
    expect(formatDayLong("2026-11-14")).toBe("Saturday, 14 November 2026");
  });

  it("formats a range", () => {
    expect(formatRange("2026-11-14T14:00:00Z", "2026-11-14T15:30:00Z", tz)).toBe("Sat, 14 Nov · 7:30 PM – 9:00 PM");
  });

  it("labels minutes from midnight and wraps past 24 hours", () => {
    expect(minuteLabel(1170)).toBe("7:30 PM");
    expect(minuteLabel(1500)).toBe("1:00 AM");
  });

  it("counts down to an expiry", () => {
    const now = new Date("2026-11-14T10:00:00Z");
    expect(countdown(new Date(now.getTime() + (12 * 60 + 20) * 1000), now)).toBe("12 min left");
    expect(countdown(new Date(now.getTime() + 65 * 60_000), now)).toBe("1 h 05 min left");
    expect(countdown(new Date(now.getTime() - 1000), now)).toBe("Expired");
  });

  it("re-exports the rupee formatter", () => {
    expect(formatInr(150000)).toContain("1,500");
  });
});

describe("marketplace formatting", () => {
  it("labels prices with their unit", () => {
    expect(priceLabel(20000, "per_hour", false)).toBe("from ₹200 per hour");
    expect(priceLabel(15000, "per_slot", false)).toBe("from ₹150 per slot");
    expect(priceLabel(15000, "per_slot", true)).toBe("from ₹150 per person per slot");
    expect(priceLabel(12550, "per_hour", null)).toBe("from ₹125.50 per hour");
    expect(priceLabel(null, "per_hour", false)).toBeNull();
    expect(priceLabel(100, null, false)).toBeNull();
  });

  it("formats month and year in the venue timezone", () => {
    expect(formatMonthYear("2026-10-31T20:00:00Z", "Asia/Kolkata")).toBe("Nov 2026");
  });
});
