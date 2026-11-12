import { describe, expect, it } from "vitest";
import { resolveRange } from "./range";

const TZ = "Asia/Kolkata";
// 01:30 on 13 Nov in India, while it is still 12 Nov in UTC.
const NOW = new Date("2026-11-12T20:00:00Z");

describe("payments range", () => {
  it("reads today as the local day, not the UTC day", () => {
    const r = resolveRange({}, TZ, NOW);
    expect(r).toMatchObject({ key: "today", fromDate: "2026-11-13", toDate: "2026-11-13" });
    expect(r.from.toISOString()).toBe("2026-11-12T18:30:00.000Z");
    expect(r.to.toISOString()).toBe("2026-11-13T18:30:00.000Z");
    expect(r.notice).toBeUndefined();
  });

  it("covers today and the six days before for 7 days, and 30 days likewise", () => {
    expect(resolveRange({ range: "7d" }, TZ, NOW)).toMatchObject({ key: "7d", fromDate: "2026-11-07", toDate: "2026-11-13" });
    expect(resolveRange({ range: "30d" }, TZ, NOW)).toMatchObject({ key: "30d", fromDate: "2026-10-15", toDate: "2026-11-13" });
  });

  it("takes custom dates inclusively and ends the instant range after the last day", () => {
    const r = resolveRange({ range: "custom", from: "2026-11-01", to: "2026-11-03" }, TZ, NOW);
    expect(r).toMatchObject({ key: "custom", fromDate: "2026-11-01", toDate: "2026-11-03" });
    expect(r.from.toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(r.to.toISOString()).toBe("2026-11-03T18:30:00.000Z");
    expect(resolveRange({ range: "custom", from: "2026-11-05", to: "2026-11-05" }, TZ, NOW).key).toBe("custom");
  });

  it("falls back to today with a notice for custom dates it cannot use", () => {
    for (const input of [
      { range: "custom" as const },
      { range: "custom" as const, from: "2026-11-01" },
      { range: "custom" as const, from: "2026-11-09", to: "2026-11-02" },
      { range: "custom" as const, from: "2026-02-31", to: "2026-03-02" },
      { range: "custom" as const, from: "2024-01-01", to: "2026-01-01" },
    ]) {
      const r = resolveRange(input, TZ, NOW);
      expect(r.key).toBe("today");
      expect(r.fromDate).toBe("2026-11-13");
      expect(r.notice).toBeTruthy();
    }
  });
});
