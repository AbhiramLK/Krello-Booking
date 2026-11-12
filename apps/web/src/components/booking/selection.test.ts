import { describe, expect, it } from "vitest";
import type { SlotView } from "@krello/booking-engine";
import { clickSlot, prune, windowInstants, type GridResource, type Selection } from "./selection";

const DAY = Date.UTC(2026, 10, 14, 0, 0) - 330 * 60_000; // local midnight in IST

function slots(from: number, to: number, length: number, over: Record<number, Partial<SlotView>> = {}): SlotView[] {
  const out: SlotView[] = [];
  for (let m = from; m + length <= to; m += length) {
    out.push({
      startsAt: new Date(DAY + m * 60_000).toISOString(),
      endsAt: new Date(DAY + (m + length) * 60_000).toISOString(),
      startMinute: m,
      endMinute: m + length,
      state: "available",
      remaining: 1,
      price: 30000,
      ...over[m],
    });
  }
  return out;
}

const H = 60;
const table1: GridResource = { resourceId: "t1", name: "Table 1", bookingMode: "exclusive", capacity: 4, slots: slots(11 * H, 23 * H, 60) };
const table2: GridResource = {
  resourceId: "t2",
  name: "Table 2",
  bookingMode: "exclusive",
  capacity: 4,
  slots: slots(11 * H, 23 * H, 60, { [13 * H]: { state: "confirmed", remaining: 0 } }),
};
const vip: GridResource = { resourceId: "vip", name: "VIP table", bookingMode: "exclusive", capacity: 4, slots: slots(11 * H, 23 * H, 90) };
const swim: GridResource = {
  resourceId: "swim",
  name: "Open swim",
  bookingMode: "shared",
  capacity: 10,
  slots: slots(11 * H, 23 * H, 60).map((s) => ({ ...s, remaining: s.startMinute === 12 * H ? 2 : 10 })),
};
const all = [table1, table2, vip, swim];
const slot = (r: GridResource, minute: number) => r.slots.find((s) => s.startMinute === minute)!;
const set = (o: ReturnType<typeof clickSlot>) => {
  if (o.kind !== "set") throw new Error(`expected set, got ${o.kind}`);
  return o.selection;
};

describe("clickSlot", () => {
  it("selects, extends and trims a window on one resource", () => {
    let sel = set(clickSlot(null, all, table1, slot(table1, 18 * H), 2));
    expect(sel).toEqual({ resourceIds: ["t1"], startMinute: 18 * H, endMinute: 19 * H });
    sel = set(clickSlot(sel, all, table1, slot(table1, 19 * H), 2));
    sel = set(clickSlot(sel, all, table1, slot(table1, 17 * H), 2));
    expect(sel).toMatchObject({ startMinute: 17 * H, endMinute: 20 * H });
    sel = set(clickSlot(sel, all, table1, slot(table1, 17 * H), 2));
    expect(sel).toMatchObject({ startMinute: 18 * H, endMinute: 20 * H });
    sel = set(clickSlot(sel, all, table1, slot(table1, 19 * H), 2));
    expect(sel).toMatchObject({ startMinute: 18 * H, endMinute: 19 * H });
    expect(set(clickSlot(sel, all, table1, slot(table1, 18 * H), 2))).toBeNull();
  });

  it("adds another resource only when it is free for the whole window", () => {
    const sel: Selection = { resourceIds: ["t1"], startMinute: 11 * H, endMinute: 14 * H };
    // Two 90-minute VIP slots make 11:00–14:00 exactly.
    expect(set(clickSlot(sel, all, vip, slot(vip, 11 * H), 2))).toEqual({ ...sel, resourceIds: ["t1", "vip"] });
    // Table 2 is booked at 13:00, so it cannot join.
    const o = clickSlot(sel, all, table2, slot(table2, 11 * H), 2);
    expect(o).toMatchObject({ kind: "confirm", next: { resourceIds: ["t2"], startMinute: 11 * H, endMinute: 12 * H } });
  });

  it("asks before replacing a selection at another time", () => {
    const sel: Selection = { resourceIds: ["t1"], startMinute: 18 * H, endMinute: 19 * H };
    expect(clickSlot(sel, all, table2, slot(table2, 20 * H), 2).kind).toBe("confirm");
    expect(clickSlot(sel, all, table1, slot(table1, 21 * H), 2).kind).toBe("confirm");
  });

  it("refuses to extend when another selected resource cannot follow", () => {
    const sel: Selection = { resourceIds: ["t1", "vip"], startMinute: 11 * H, endMinute: 14 * H };
    // 11:00–15:00 is not whole 90-minute slots.
    expect(clickSlot(sel, all, table1, slot(table1, 14 * H), 2).kind).toBe("confirm");
  });

  it("drops a resource that cannot follow a trimmed window, and ignores unbookable slots", () => {
    const sel: Selection = { resourceIds: ["t1", "vip"], startMinute: 11 * H, endMinute: 14 * H };
    const o = clickSlot(sel, all, table1, slot(table1, 13 * H), 2);
    expect(o).toMatchObject({ kind: "set", selection: { resourceIds: ["t1"], endMinute: 13 * H } });
    expect(o.kind === "set" && o.notice).toContain("VIP table");
    expect(set(clickSlot(null, all, table2, slot(table2, 13 * H), 2))).toBeNull();
  });

  it("needs enough places on a shared resource for the group", () => {
    expect(set(clickSlot(null, all, swim, slot(swim, 12 * H), 2))).not.toBeNull();
    expect(set(clickSlot(null, all, swim, slot(swim, 12 * H), 3))).toBeNull();
  });
});

describe("prune and windowInstants", () => {
  it("removes resources whose slots were taken and keeps the rest", () => {
    const sel: Selection = { resourceIds: ["t1", "t2"], startMinute: 12 * H, endMinute: 14 * H };
    expect(prune(sel, all, 2)).toEqual({ selection: { ...sel, resourceIds: ["t1"] }, dropped: ["Table 2"] });
  });

  it("uses the server's instants for the window", () => {
    const sel: Selection = { resourceIds: ["vip"], startMinute: 11 * H, endMinute: 14 * H };
    expect(windowInstants(sel, all, 2)).toEqual({ startsAt: slot(vip, 11 * H).startsAt, endsAt: slot(vip, 12 * H + 30).endsAt });
  });
});
