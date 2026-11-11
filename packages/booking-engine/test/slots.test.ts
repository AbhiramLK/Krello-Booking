import { describe, expect, it } from "vitest";
import { chainSlots, dayOfWeek, generateSlots, localDateOf, localToInstant, minuteOfDate } from "../src";

const hours = [{ opensMinute: 540, closesMinute: 1380 }];
const sched = (o: number, c: number, d: number, i = d) => ({
  opensMinute: o,
  closesMinute: c,
  slotDurationMinutes: d,
  slotIntervalMinutes: i,
});

describe("generateSlots", () => {
  it("generates fixed slots and drops a trailing partial slot", () => {
    const s = generateSlots({ schedules: [sched(600, 830, 90)], locationHours: hours, locationHasHours: true });
    expect(s).toEqual([
      { startMinute: 600, endMinute: 690 },
      { startMinute: 690, endMinute: 780 },
    ]);
  });

  it("supports an interval shorter than the duration, giving overlapping slots", () => {
    const s = generateSlots({ schedules: [sched(600, 720, 60, 30)], locationHours: hours, locationHasHours: true });
    expect(s.map((x) => x.startMinute)).toEqual([600, 630, 660]);
  });

  it("treats the gap between two schedule rows as a break", () => {
    const s = generateSlots({
      schedules: [sched(600, 720, 60), sched(840, 960, 60)],
      locationHours: hours,
      locationHasHours: true,
    });
    expect(s.map((x) => x.startMinute)).toEqual([600, 660, 840, 900]);
  });

  it("never offers a slot outside the location hours", () => {
    // The resource schedule starts at 08:00 but the venue opens at 09:00.
    const s = generateSlots({ schedules: [sched(480, 720, 60)], locationHours: hours, locationHasHours: true });
    expect(s.map((x) => x.startMinute)).toEqual([540, 600, 660]);
  });

  it("closes on a location holiday, but a resource override wins over it", () => {
    const closed = { exceptionType: "closed" as const, opensMinute: null, closesMinute: null };
    const base = { schedules: [sched(600, 720, 60)], locationHours: hours, locationHasHours: true };
    expect(generateSlots({ ...base, locationException: closed })).toEqual([]);
    const special = { exceptionType: "custom_hours" as const, opensMinute: 360, closesMinute: 480 };
    expect(
      generateSlots({ ...base, locationException: closed, resourceException: special }).map((x) => x.startMinute),
    ).toEqual([360, 420]);
    expect(generateSlots({ ...base, resourceException: closed })).toEqual([]);
  });
});

describe("chainSlots", () => {
  const slots = generateSlots({ schedules: [sched(600, 840, 60)], locationHours: [], locationHasHours: false });
  it("accepts one slot or several back-to-back, and nothing else", () => {
    expect(chainSlots(slots, 600, 660)).toHaveLength(1);
    expect(chainSlots(slots, 660, 840)).toHaveLength(3);
    expect(chainSlots(slots, 630, 690)).toBeNull();
    expect(chainSlots(slots, 600, 650)).toBeNull();
    expect(chainSlots(slots, 780, 900)).toBeNull();
  });
});

describe("time helpers", () => {
  it("converts venue-local time to instants and back", () => {
    const t = localToInstant("2026-11-14", 14 * 60 + 30, "Asia/Kolkata");
    expect(t.toISOString()).toBe("2026-11-14T09:00:00.000Z");
    expect(localDateOf(new Date("2026-11-14T19:00:00Z"), "Asia/Kolkata")).toBe("2026-11-15");
    expect(minuteOfDate(new Date("2026-11-14T19:30:00Z"), "2026-11-14", "Asia/Kolkata")).toBe(25 * 60);
    expect(dayOfWeek("2026-11-14")).toBe(6);
  });

  it("handles a zone with daylight saving", () => {
    expect(localToInstant("2026-07-01", 12 * 60, "Europe/London").toISOString()).toBe("2026-07-01T11:00:00.000Z");
    expect(localToInstant("2026-01-01", 12 * 60, "Europe/London").toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });
});
