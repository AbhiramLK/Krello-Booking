// Pure selection rules for the slot grid. No React, no server imports.
// The engine accepts one time window shared by every chosen resource, made of
// whole consecutive slots of each resource; these helpers keep the selection
// inside that rule so the customer can only build a request it will accept.
import type { ResourceAvailability, SlotView } from "@krello/booking-engine";
import { chainSlots } from "@krello/booking-engine/slots";

export type GridResource = Pick<ResourceAvailability, "resourceId" | "name" | "bookingMode" | "capacity" | "slots">;

export interface Selection {
  resourceIds: string[];
  startMinute: number;
  endMinute: number;
}

export type ClickOutcome =
  | { kind: "set"; selection: Selection | null; notice?: string }
  /** The click would start over; ask first. */
  | { kind: "confirm"; next: Selection; message: string };

/** Can this slot be part of a request for `groupSize` people? */
export function slotBookable(r: GridResource, s: SlotView, groupSize: number): boolean {
  const need = r.bookingMode === "shared" ? groupSize : 1;
  return s.state === "available" && s.price !== null && s.remaining >= need;
}

/** The bookable slots of `r` that make up [start, end) back to back, or null. */
export function windowChain(r: GridResource, start: number, end: number, groupSize: number): SlotView[] | null {
  const usable = r.slots.filter((s) => slotBookable(r, s, groupSize));
  return chainSlots(usable, start, end) as SlotView[] | null;
}

export function isSelected(sel: Selection | null, r: GridResource, s: SlotView, groupSize: number): boolean {
  if (!sel || !sel.resourceIds.includes(r.resourceId)) return false;
  return (windowChain(r, sel.startMinute, sel.endMinute, groupSize) ?? []).some(
    (c) => c.startMinute === s.startMinute && c.endMinute === s.endMinute,
  );
}

/** Keeps the resources that can still be booked for the whole window. */
export function prune(
  sel: Selection | null,
  resources: GridResource[],
  groupSize: number,
): { selection: Selection | null; dropped: string[] } {
  if (!sel) return { selection: null, dropped: [] };
  const keep: string[] = [];
  const dropped: string[] = [];
  for (const id of sel.resourceIds) {
    const r = resources.find((x) => x.resourceId === id);
    if (r && windowChain(r, sel.startMinute, sel.endMinute, groupSize)) keep.push(id);
    else dropped.push(r?.name ?? "An item");
  }
  return { selection: keep.length ? { ...sel, resourceIds: keep } : null, dropped };
}

const names = (list: string[]) =>
  list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;

/** Applies a window change to every selected resource, dropping those that cannot follow it. */
function reshape(sel: Selection, resources: GridResource[], start: number, end: number, groupSize: number): ClickOutcome {
  const { selection, dropped } = prune({ ...sel, startMinute: start, endMinute: end }, resources, groupSize);
  return {
    kind: "set",
    selection,
    notice: dropped.length ? `${names(dropped)} cannot be booked for that time, so it was removed.` : undefined,
  };
}

/**
 * What a click on slot `s` of resource `r` does:
 * - nothing selected: select it;
 * - the next or previous slot of a selected resource: extend the window, if every selected resource can follow;
 * - a selected slot: deselect it (the first slot trims the start; any other trims it and everything after);
 * - a slot inside the window on another resource that has the whole window free: add that resource;
 * - anything else asks before replacing the selection with this one slot.
 */
export function clickSlot(
  sel: Selection | null,
  resources: GridResource[],
  r: GridResource,
  s: SlotView,
  groupSize: number,
): ClickOutcome {
  const single: Selection = { resourceIds: [r.resourceId], startMinute: s.startMinute, endMinute: s.endMinute };
  if (!slotBookable(r, s, groupSize) && !isSelected(sel, r, s, groupSize)) return { kind: "set", selection: sel };
  if (!sel) return { kind: "set", selection: single };

  const replace = (message: string): ClickOutcome => ({ kind: "confirm", next: single, message });

  if (sel.resourceIds.includes(r.resourceId)) {
    const chain = windowChain(r, sel.startMinute, sel.endMinute, groupSize) ?? [];
    const at = chain.findIndex((c) => c.startMinute === s.startMinute && c.endMinute === s.endMinute);
    if (at >= 0) {
      if (chain.length === 1) {
        const rest = sel.resourceIds.filter((id) => id !== r.resourceId);
        return { kind: "set", selection: rest.length ? { ...sel, resourceIds: rest } : null };
      }
      return at === 0
        ? reshape(sel, resources, s.endMinute, sel.endMinute, groupSize)
        : reshape(sel, resources, sel.startMinute, s.startMinute, groupSize);
    }
    const extended =
      s.startMinute === sel.endMinute
        ? { start: sel.startMinute, end: s.endMinute }
        : s.endMinute === sel.startMinute
          ? { start: s.startMinute, end: sel.endMinute }
          : null;
    if (extended) {
      const blocked: string[] = [];
      for (const id of sel.resourceIds) {
        const x = resources.find((y) => y.resourceId === id);
        if (!x || !windowChain(x, extended.start, extended.end, groupSize)) blocked.push(x?.name ?? "An item");
      }
      if (!blocked.length) return { kind: "set", selection: { ...sel, startMinute: extended.start, endMinute: extended.end } };
      return replace(`${names(blocked)} cannot be booked for that longer time. Start a new selection with just this slot?`);
    }
    return replace("All items in one request share the same time. Start a new selection with just this slot?");
  }

  const chain = windowChain(r, sel.startMinute, sel.endMinute, groupSize);
  if (chain?.some((c) => c.startMinute === s.startMinute && c.endMinute === s.endMinute)) {
    return { kind: "set", selection: { ...sel, resourceIds: [...sel.resourceIds, r.resourceId] } };
  }
  return replace(
    `${r.name} cannot be booked for the time you have chosen, and all items in one request share the same time. Start a new selection with just this slot?`,
  );
}

/** The instants of the selected window, taken from the server's own slots. */
export function windowInstants(sel: Selection, resources: GridResource[], groupSize: number): { startsAt: string; endsAt: string } | null {
  for (const id of sel.resourceIds) {
    const r = resources.find((x) => x.resourceId === id);
    const chain = r && windowChain(r, sel.startMinute, sel.endMinute, groupSize);
    if (chain?.length) return { startsAt: chain[0]!.startsAt, endsAt: chain[chain.length - 1]!.endsAt };
  }
  return null;
}

/**
 * After fresh slots arrive (or the group size changes): the selection without
 * anything that can no longer be booked, and a message when something went.
 * A changed selection is a different request, so the caller sends the customer
 * back to the grid to see it, and its new price, before anything is sent.
 */
export function afterRefresh(
  sel: Selection | null,
  resources: GridResource[],
  groupSize: number,
): { changed: boolean; selection: Selection | null; notice: string | null } {
  const { selection, dropped } = prune(sel, resources, groupSize);
  if (!dropped.length) return { changed: false, selection: sel, notice: null };
  const one = dropped.length === 1;
  return {
    changed: true,
    selection,
    notice: `${names(dropped)} ${one ? "is" : "are"} no longer available for that time, so we removed ${one ? "it" : "them"} from your selection. Check it before you send your request.`,
  };
}

/**
 * A request may go only from the details step, for the selection on screen,
 * once its price has been worked out for exactly that selection.
 */
export function readyToSend(s: {
  step: "pick" | "details";
  selectionKey: string;
  quote: { status: "loading" | "ready" | "error"; key?: string };
}): boolean {
  return s.step === "details" && s.selectionKey !== "" && s.quote.status === "ready" && s.quote.key === s.selectionKey;
}

/**
 * Whether the panel stays locked after a submission. An accepted request keeps
 * it locked, with the same idempotency key, until navigation unmounts the
 * panel, so a click made while the status page loads sends nothing. Every
 * failure unlocks it so the customer can try again.
 */
export function keepsSubmitLocked(result: { ok: boolean }): boolean {
  return result.ok;
}
