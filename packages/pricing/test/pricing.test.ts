import { describe, expect, it } from "vitest";
import { calculatePrice, findRuleConflicts, formatInr, PricingError, type PriceRequest, type PricingRule } from "../src";

const R = "res-1";
const req = (over: Partial<PriceRequest> = {}): PriceRequest => ({
  resourceId: R,
  priceUnit: "per_hour",
  pricePerPerson: false,
  slotDurationMinutes: 60,
  date: "2026-11-14", // a Saturday
  dayOfWeek: 6,
  startMinute: 16 * 60 + 30,
  endMinute: 18 * 60 + 30,
  groupSize: 1,
  ...over,
});
const rule = (id: string, over: Partial<PricingRule>): PricingRule => ({
  id,
  resourceId: R,
  ruleType: "base",
  amount: 20000,
  priority: 0,
  ...over,
});

describe("calculatePrice", () => {
  const base = rule("base", {});
  const peak = rule("peak", { ruleType: "time_of_day", startMinute: 17 * 60, endMinute: 23 * 60, amount: 30000 });

  it("splits a booking that crosses a price boundary (spec 9.3)", () => {
    const r = calculatePrice(req({ dayOfWeek: 2, date: "2026-11-10" }), [base, peak]);
    // 16:30–17:00 at ₹200/h, 17:00–18:30 at ₹300/h
    expect(r.segments.map((s) => [s.startMinute, s.endMinute, s.amount])).toEqual([
      [990, 1020, 10000],
      [1020, 1110, 45000],
    ]);
    expect(r.total).toBe(55000);
  });

  it("applies precedence: date override > special date > weekday rule > time of day > base", () => {
    const weekend = rule("weekend", { ruleType: "day_of_week", daysOfWeek: [0, 6], amount: 35000 });
    const festival = rule("festival", { ruleType: "special_date", date: "2026-11-14", amount: 50000 });
    const override = rule("override", { ruleType: "date_override", date: "2026-11-14", amount: 10000 });
    const one = (rules: PricingRule[]) => calculatePrice(req({ startMinute: 1080, endMinute: 1140 }), rules).total;
    expect(one([base])).toBe(20000);
    expect(one([base, peak])).toBe(30000);
    expect(one([base, peak, weekend])).toBe(35000);
    expect(one([base, peak, weekend, festival])).toBe(50000);
    expect(one([base, peak, weekend, festival, override])).toBe(10000);
  });

  it("prefers a resource rule to a location default, and never stacks rules", () => {
    const locationDefault = rule("loc", { resourceId: null, ruleType: "date_override", date: "2026-11-14", amount: 99900 });
    expect(calculatePrice(req({ startMinute: 600, endMinute: 660 }), [base, locationDefault]).total).toBe(20000);
    expect(calculatePrice(req({ resourceId: "other", startMinute: 600, endMinute: 660 }), [base, locationDefault]).total).toBe(99900);
  });

  it("prices per slot and per person", () => {
    const r = calculatePrice(
      req({ priceUnit: "per_slot", pricePerPerson: true, slotDurationMinutes: 45, startMinute: 360, endMinute: 450, groupSize: 4 }),
      [rule("swim", { amount: 15000 })],
    );
    expect(r.total).toBe(15000 * 2 * 4);
  });

  it("rejects ambiguous rules and missing prices instead of guessing", () => {
    const a = rule("a", { ruleType: "time_of_day", startMinute: 600, endMinute: 900, amount: 100 });
    const b = rule("b", { ruleType: "time_of_day", startMinute: 800, endMinute: 1000, amount: 200 });
    expect(() => calculatePrice(req({ startMinute: 780, endMinute: 900 }), [a, b])).toThrowError(PricingError);
    expect(findRuleConflicts([a, b])).toHaveLength(1);
    expect(findRuleConflicts([a, { ...b, priority: 1 }])).toHaveLength(0);
    expect(() => calculatePrice(req(), [])).toThrowError(/No price/);
  });

  it("honours effective dates and uses priority to break ties", () => {
    const old = rule("old", { amount: 10000, effectiveTo: "2026-10-31" });
    const current = rule("new", { amount: 25000, effectiveFrom: "2026-11-01" });
    expect(calculatePrice(req({ startMinute: 600, endMinute: 660 }), [old, current]).total).toBe(25000);
    const promo = rule("promo", { amount: 5000, priority: 5 });
    expect(calculatePrice(req({ startMinute: 600, endMinute: 660 }), [current, promo]).total).toBe(5000);
  });
});

describe("formatInr", () => {
  it("uses Indian digit grouping", () => {
    expect(formatInr(18425000)).toBe("₹1,84,250");
    expect(formatInr(15050)).toBe("₹150.50");
  });
});
