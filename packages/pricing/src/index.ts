/**
 * Pricing calculation. Pure functions: no database, no clock.
 *
 * A booking interval is priced by cutting it at every boundary of an applicable
 * time-bound rule, choosing one winning rule per segment, and summing the
 * segments (decisions.md OD-08). Rules never stack.
 */

export type PricingRuleType = "base" | "time_of_day" | "day_of_week" | "special_date" | "date_override";

export interface PricingRule {
  id: string;
  /** Null for a location-wide default. */
  resourceId: string | null;
  ruleType: PricingRuleType;
  label?: string | null;
  daysOfWeek?: number[] | null;
  /** YYYY-MM-DD */
  date?: string | null;
  startMinute?: number | null;
  endMinute?: number | null;
  /** Paise per price unit. */
  amount: number;
  priority: number;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

export interface PriceRequest {
  resourceId: string;
  priceUnit: "per_hour" | "per_slot";
  pricePerPerson: boolean;
  /** Length of one slot, used when priceUnit is per_slot. */
  slotDurationMinutes: number;
  /** Local calendar date of the booking, YYYY-MM-DD. */
  date: string;
  dayOfWeek: number;
  /** Minutes from local midnight of `date`; may exceed 1440. */
  startMinute: number;
  endMinute: number;
  groupSize: number;
}

export interface PriceSegment {
  startMinute: number;
  endMinute: number;
  ruleId: string;
  ruleType: PricingRuleType;
  ruleLabel: string | null;
  /** Paise per price unit. */
  unitRate: number;
  /** Hours or slots, depending on the unit. */
  quantity: number;
  /** Multiplier applied for per-person pricing. */
  persons: number;
  amount: number;
}

export interface PriceResult {
  currency: "INR";
  priceUnit: "per_hour" | "per_slot";
  segments: PriceSegment[];
  total: number;
}

export class PricingError extends Error {
  constructor(
    public code: "no_price" | "ambiguous_rules" | "invalid_request",
    message: string,
  ) {
    super(message);
    this.name = "PricingError";
  }
}

const TYPE_RANK: Record<PricingRuleType, number> = {
  date_override: 5,
  special_date: 4,
  day_of_week: 3,
  time_of_day: 2,
  base: 1,
};

function hasWindow(r: PricingRule): r is PricingRule & { startMinute: number; endMinute: number } {
  return r.startMinute != null && r.endMinute != null;
}

/** Does the rule apply on this date at all (ignoring its time window)? */
function appliesOnDate(r: PricingRule, req: PriceRequest): boolean {
  if (r.resourceId !== null && r.resourceId !== req.resourceId) return false;
  if (r.effectiveFrom && req.date < r.effectiveFrom) return false;
  if (r.effectiveTo && req.date > r.effectiveTo) return false;
  if (r.ruleType === "date_override" || r.ruleType === "special_date") {
    if (r.date !== req.date) return false;
  } else if (r.date && r.date !== req.date) {
    return false;
  }
  if (r.ruleType === "day_of_week" && !(r.daysOfWeek && r.daysOfWeek.length)) return false;
  if (r.daysOfWeek && r.daysOfWeek.length && !r.daysOfWeek.includes(req.dayOfWeek)) return false;
  if (r.ruleType === "time_of_day" && !hasWindow(r)) return false;
  return true;
}

function coversSegment(r: PricingRule, start: number, end: number): boolean {
  if (!hasWindow(r)) return true;
  return r.startMinute <= start && r.endMinute >= end;
}

/** Higher wins. Resource rules beat location defaults, then type, then priority. */
function compareRules(a: PricingRule, b: PricingRule): number {
  const scope = Number(a.resourceId !== null) - Number(b.resourceId !== null);
  if (scope) return scope;
  const type = TYPE_RANK[a.ruleType] - TYPE_RANK[b.ruleType];
  if (type) return type;
  return a.priority - b.priority;
}

function pickRule(candidates: PricingRule[], start: number, end: number): PricingRule {
  if (!candidates.length) {
    throw new PricingError("no_price", `No price is configured for ${fmt(start)}–${fmt(end)}.`);
  }
  const sorted = [...candidates].sort((a, b) => compareRules(b, a));
  const winner = sorted[0]!;
  const rival = sorted[1];
  if (rival && compareRules(winner, rival) === 0 && rival.amount !== winner.amount) {
    throw new PricingError(
      "ambiguous_rules",
      `Two pricing rules of equal rank disagree for ${fmt(start)}–${fmt(end)}. Give one a higher priority.`,
    );
  }
  return winner;
}

function fmt(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function calculatePrice(req: PriceRequest, rules: PricingRule[]): PriceResult {
  if (!(req.endMinute > req.startMinute) || req.groupSize < 1 || req.slotDurationMinutes < 1) {
    throw new PricingError("invalid_request", "Invalid pricing request.");
  }
  const applicable = rules.filter((r) => appliesOnDate(r, req));

  const cuts = new Set<number>([req.startMinute, req.endMinute]);
  for (const r of applicable) {
    if (!hasWindow(r)) continue;
    for (const m of [r.startMinute, r.endMinute]) {
      if (m > req.startMinute && m < req.endMinute) cuts.add(m);
    }
  }
  const points = [...cuts].sort((a, b) => a - b);

  const persons = req.pricePerPerson ? req.groupSize : 1;
  const unitMinutes = req.priceUnit === "per_hour" ? 60 : req.slotDurationMinutes;
  const segments: PriceSegment[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]!;
    const end = points[i + 1]!;
    const rule = pickRule(
      applicable.filter((r) => coversSegment(r, start, end)),
      start,
      end,
    );
    const quantity = (end - start) / unitMinutes;
    const amount = Math.round(rule.amount * quantity * persons);
    const prev = segments[segments.length - 1];
    if (prev && prev.ruleId === rule.id) {
      // Merge adjacent pieces priced by the same rule.
      prev.endMinute = end;
      prev.quantity = (prev.endMinute - prev.startMinute) / unitMinutes;
      prev.amount = Math.round(rule.amount * prev.quantity * persons);
    } else {
      segments.push({
        startMinute: start,
        endMinute: end,
        ruleId: rule.id,
        ruleType: rule.ruleType,
        ruleLabel: rule.label ?? null,
        unitRate: rule.amount,
        quantity,
        persons,
        amount,
      });
    }
  }

  return {
    currency: "INR",
    priceUnit: req.priceUnit,
    segments,
    total: segments.reduce((sum, s) => sum + s.amount, 0),
  };
}

/**
 * Finds pairs of rules that would be ambiguous: same scope, type and priority,
 * able to apply at the same moment, with different amounts. Used to reject bad
 * configuration when a rule is saved.
 */
export function findRuleConflicts(rules: PricingRule[]): Array<[PricingRule, PricingRule]> {
  const out: Array<[PricingRule, PricingRule]> = [];
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i]!;
      const b = rules[j]!;
      if (a.resourceId !== b.resourceId || a.ruleType !== b.ruleType || a.priority !== b.priority) continue;
      if (a.amount === b.amount) continue;
      if (a.date && b.date && a.date !== b.date) continue;
      if (a.daysOfWeek?.length && b.daysOfWeek?.length && !a.daysOfWeek.some((d) => b.daysOfWeek!.includes(d))) continue;
      if (hasWindow(a) && hasWindow(b) && (a.endMinute <= b.startMinute || b.endMinute <= a.startMinute)) continue;
      if (a.effectiveTo && b.effectiveFrom && a.effectiveTo < b.effectiveFrom) continue;
      if (b.effectiveTo && a.effectiveFrom && b.effectiveTo < a.effectiveFrom) continue;
      out.push([a, b]);
    }
  }
  return out;
}

/** Formats paise as rupees, e.g. 184250_00 → "₹1,84,250". */
export function formatInr(paise: number): string {
  const rupees = paise / 100;
  return (
    "₹" +
    rupees.toLocaleString("en-IN", {
      minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
}
