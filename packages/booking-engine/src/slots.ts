/** Fixed-slot generation. Pure: works on minutes from local midnight. Browser code may import `@krello/booking-engine/slots`. */

export interface Slot {
  startMinute: number;
  endMinute: number;
}

export interface ScheduleWindow {
  opensMinute: number;
  closesMinute: number;
  slotDurationMinutes: number;
  slotIntervalMinutes: number;
}

export interface HoursWindow {
  opensMinute: number;
  closesMinute: number;
}

export interface DayException {
  exceptionType: "closed" | "custom_hours";
  opensMinute: number | null;
  closesMinute: number | null;
}

export interface SlotInputs {
  /** The resource's schedule rows for this weekday, already date-filtered. */
  schedules: ScheduleWindow[];
  /** The location's hours for this weekday. */
  locationHours: HoursWindow[];
  /** True when the location has opening hours configured for any weekday. */
  locationHasHours: boolean;
  resourceException?: DayException | null;
  locationException?: DayException | null;
}

function generate(w: ScheduleWindow): Slot[] {
  const out: Slot[] = [];
  for (let s = w.opensMinute; s + w.slotDurationMinutes <= w.closesMinute; s += w.slotIntervalMinutes) {
    out.push({ startMinute: s, endMinute: s + w.slotDurationMinutes });
  }
  return out;
}

const inside = (s: Slot, w: HoursWindow) => s.startMinute >= w.opensMinute && s.endMinute <= w.closesMinute;

/**
 * Precedence (spec 7.2): a resource-level dated exception wins outright, then a
 * location-level dated exception, then the resource's weekly schedule clipped
 * to the location's weekly hours.
 */
export function generateSlots(input: SlotInputs): Slot[] {
  const { schedules, resourceException: rx, locationException: lx } = input;
  if (!schedules.length) return [];

  let slots: Slot[];
  if (rx) {
    if (rx.exceptionType === "closed" || rx.opensMinute == null || rx.closesMinute == null) return [];
    // An explicit resource override may run outside the location's hours.
    const base = schedules[0]!;
    slots = generate({ ...base, opensMinute: rx.opensMinute, closesMinute: rx.closesMinute });
  } else {
    slots = schedules.flatMap(generate);
    if (lx) {
      if (lx.exceptionType === "closed" || lx.opensMinute == null || lx.closesMinute == null) return [];
      const w = { opensMinute: lx.opensMinute, closesMinute: lx.closesMinute };
      slots = slots.filter((s) => inside(s, w));
    } else if (input.locationHasHours) {
      slots = slots.filter((s) => input.locationHours.some((w) => inside(s, w)));
    }
  }

  const seen = new Set<string>();
  return slots
    .filter((s) => {
      const k = `${s.startMinute}-${s.endMinute}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
}

/**
 * Can [startMinute, endMinute) be made from consecutive generated slots, each
 * starting where the previous one ended? Returns the chain, or null.
 */
export function chainSlots(slots: Slot[], startMinute: number, endMinute: number): Slot[] | null {
  const byStart = new Map<number, Slot[]>();
  for (const s of slots) {
    const list = byStart.get(s.startMinute) ?? [];
    list.push(s);
    byStart.set(s.startMinute, list);
  }
  const walk = (at: number, acc: Slot[]): Slot[] | null => {
    if (at === endMinute) return acc;
    if (at > endMinute || acc.length > 48) return null;
    for (const s of byStart.get(at) ?? []) {
      const found = walk(s.endMinute, [...acc, s]);
      if (found) return found;
    }
    return null;
  };
  const chain = walk(startMinute, []);
  return chain && chain.length ? chain : null;
}
