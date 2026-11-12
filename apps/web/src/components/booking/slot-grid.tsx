"use client";

import { Check } from "lucide-react";
import type { ResourceAvailability, SlotView } from "@krello/booking-engine";
import { formatInr, minuteLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isSelected, slotBookable, type Selection } from "./selection";

interface SlotGridProps {
  resources: ResourceAvailability[];
  selection: Selection | null;
  groupSize: number;
  onSlot: (resource: ResourceAvailability, slot: SlotView) => void;
}

const STATE_TEXT: Record<Exclude<SlotView["state"], "available">, string> = {
  pending_hold: "On hold",
  confirmed: "Booked",
  blocked: "—",
  unavailable: "—",
};

const SPOKEN_STATE: Record<Exclude<SlotView["state"], "available">, string> = {
  pending_hold: "on hold for another request",
  confirmed: "booked",
  blocked: "not available",
  unavailable: "not available",
};

function slotLength(r: ResourceAvailability): number | null {
  const s = r.slots[0];
  return s ? s.endMinute - s.startMinute : null;
}

/** Width of one hour on the grid, in pixels. */
const HOUR_PX = 84;

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/**
 * Columns for the grid. Normally time runs across in proportion, so a 90-minute
 * slot is half as wide again as a 60-minute one and back-to-back slots touch.
 * When a resource offers overlapping slots that cannot work, so each distinct
 * start time gets a column instead.
 */
function gridLayout(resources: ResourceAvailability[]): { template: string; column: (s: SlotView) => string } {
  const all = resources.flatMap((r) => r.slots);
  const origin = Math.min(...all.map((s) => s.startMinute));
  const end = Math.max(...all.map((s) => s.endMinute));
  const overlapping = resources.some((r) => r.slots.some((s, i) => i > 0 && s.startMinute < r.slots[i - 1]!.endMinute));
  const unit = all.reduce((u, s) => gcd(gcd(u, s.startMinute - origin), s.endMinute - s.startMinute), 0);
  if (!overlapping && unit >= 5 && (end - origin) / unit <= 400) {
    return {
      template: `repeat(${(end - origin) / unit}, ${((HOUR_PX * unit) / 60).toFixed(2)}px)`,
      column: (s) => `${(s.startMinute - origin) / unit + 2} / span ${(s.endMinute - s.startMinute) / unit}`,
    };
  }
  const starts = [...new Set(all.map((s) => s.startMinute))].sort((a, b) => a - b);
  return { template: `repeat(${starts.length}, ${HOUR_PX}px)`, column: (s) => `${starts.indexOf(s.startMinute) + 2}` };
}

/** Resources down the side, slot times across. Scrolls sideways on small screens. */
export function SlotGrid({ resources, selection, groupSize, onSlot }: SlotGridProps) {
  const { template, column } = gridLayout(resources);

  return (
    <div className="overflow-x-auto pb-2 [scrollbar-width:thin]">
      <div
        role="table"
        aria-label="Available slots"
        className="grid w-max gap-y-1.5"
        style={{ gridTemplateColumns: `minmax(6.5rem, 7.5rem) ${template}` }}
      >
        {resources.map((r, row) => {
          const length = slotLength(r);
          return (
            <div key={r.resourceId} role="row" className="contents">
              <div role="rowheader" style={{ gridRow: row + 1, gridColumn: 1 }} className="sticky left-0 z-10 flex flex-col justify-center bg-card pr-2">
                <span className="truncate text-sm font-medium" title={r.name}>
                  {r.name}
                </span>
                <span className="text-[11px] leading-tight text-muted-foreground">
                  {length ? `${length}-min slots` : "No slots"}
                  {r.pricePerPerson && <span className="block">Price per person</span>}
                </span>
              </div>
              {r.slots.map((slot) => (
                <div key={`${slot.startMinute}-${slot.endMinute}`} role="cell" style={{ gridRow: row + 1, gridColumn: column(slot) }} className="px-[3px]">
                  <SlotButton resource={r} slot={slot} groupSize={groupSize} selected={isSelected(selection, r, slot, groupSize)} onClick={() => onSlot(r, slot)} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SlotButton({
  resource,
  slot,
  groupSize,
  selected,
  onClick,
}: {
  resource: ResourceAvailability;
  slot: SlotView;
  groupSize: number;
  selected: boolean;
  onClick: () => void;
}) {
  const shared = resource.bookingMode === "shared";
  const bookable = slotBookable(resource, slot, groupSize);
  const nextDay = slot.startMinute >= 1440;
  const time = minuteLabel(slot.startMinute);
  const range = `${time} to ${minuteLabel(slot.endMinute)}${nextDay ? " (next day)" : ""}`;

  let detail: string;
  let spoken: string;
  if (slot.state !== "available") {
    detail = STATE_TEXT[slot.state];
    spoken = SPOKEN_STATE[slot.state];
  } else if (slot.price === null) {
    detail = "—";
    spoken = "not available";
  } else if (!bookable) {
    detail = `${slot.remaining} left`;
    spoken = `only ${slot.remaining} place${slot.remaining === 1 ? "" : "s"} left, not enough for your group`;
  } else {
    detail = formatInr(slot.price);
    spoken = `${formatInr(slot.price)}${resource.pricePerPerson ? " per person" : ""}${shared ? `, ${slot.remaining} places left` : ""}`;
  }

  return (
    <button
      type="button"
      disabled={!bookable && !selected}
      aria-pressed={selected}
      aria-label={`${resource.name}, ${range}, ${selected ? "selected, " : ""}${spoken}`}
      onClick={onClick}
      className={cn(
        "relative flex h-[3.75rem] w-full flex-col items-center justify-center rounded-xl border text-center outline-none transition-[background-color,border-color,box-shadow]",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : bookable
            ? "bg-card hover:border-primary/60 hover:bg-primary/5"
            : slot.state === "pending_hold"
              ? "cursor-not-allowed border-dashed border-foreground/25 bg-muted/40 text-muted-foreground"
              : "cursor-not-allowed border-transparent bg-muted/70 text-muted-foreground",
      )}
    >
      {selected && <Check className="absolute right-1.5 top-1.5 size-3" aria-hidden="true" />}
      <span className="tabular text-[13px] font-medium leading-tight">
        {time}
        {nextDay && <sup className="ml-0.5 text-[9px]">+1</sup>}
      </span>
      <span className={cn("tabular text-xs leading-tight", !selected && bookable && "text-muted-foreground")}>
        {detail}
      </span>
      {shared && bookable && (
        <span className={cn("tabular text-[10px] leading-tight", selected ? "text-primary-foreground/85" : "text-muted-foreground")}>
          {slot.remaining} left
        </span>
      )}
    </button>
  );
}
