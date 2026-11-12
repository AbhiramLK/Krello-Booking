"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Plus } from "lucide-react";
import type { SlotView } from "@krello/booking-engine";
import { Button } from "@/components/ui/button";
import { formatTime, minuteLabel, timeZoneName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BlockDialog } from "./block-dialog";
import {
  axisOf,
  axisWidth,
  bookingsInSlot,
  hourTicks,
  openSlots,
  PX_PER_MINUTE,
  place,
  placesTaken,
  type Axis,
} from "./geometry";
import { ManualBookingDialog } from "./manual-booking-dialog";
import { QuickView, type QuickTarget } from "./quick-view";
import type { BlockView, BookingView, DayView, ResourceView } from "./view-model";
import { CALENDAR_STATUSES, SOURCE_WORD, STATUS_WORD } from "./words";

const REFRESH_MS = 30_000;
const READ_ONLY = "Read-only: renew the subscription to manage the calendar.";

const SELECT =
  "h-10 cursor-pointer rounded-full bg-card px-3.5 text-sm font-medium shadow-xs ring-1 ring-border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** How a booking looks on the grid. The status is also written on the block: colour is never the only signal. */
const BOOKING_LOOK: Record<string, string> = {
  approved: "border-l-4 border-l-success bg-[#e3f6e8]",
  pending: "border-2 border-dashed border-warning bg-[#fff4e0]",
  completed: "border-l-4 border-l-info bg-[#e1eefc]",
  no_show: "border-l-4 border-l-destructive bg-[#fde6e4]",
  expired: "border-2 border-dashed border-border bg-[#ececf0]",
};

const HATCH = {
  backgroundImage: "repeating-linear-gradient(135deg, rgba(0,0,0,0.12) 0 5px, transparent 5px 11px)",
};

/** Hour lines behind a lane. The axis starts on the hour, so the period is exactly 60 minutes. */
const gridLines = {
  backgroundImage: "linear-gradient(to right, rgba(0,0,0,0.07) 1px, transparent 1px)",
  backgroundSize: `${60 * PX_PER_MINUTE}px 100%`,
};

export interface CalendarGridProps {
  /** The day as the server rendered it. Replaced whenever the page re-renders. */
  initial: DayView;
  locationName: string;
  canCreate: boolean;
  canBlock: boolean;
  /** False while the subscription has lapsed: the calendar reads, nothing can be added. */
  writable: boolean;
}

export function CalendarGrid({ initial, locationName, canCreate, canBlock, writable }: CalendarGridProps) {
  const router = useRouter();
  const [day, setDay] = useState(initial);
  const [prevInitial, setPrevInitial] = useState(initial);
  // A fresh render from the server replaces what the grid is holding.
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setDay(initial);
  }

  const [resourceFilter, setResourceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [quick, setQuick] = useState<QuickTarget | null>(null);
  const [manual, setManual] = useState<{ resourceId: string; startMinute: number } | "blank" | null>(null);
  const [blocking, setBlocking] = useState(false);
  const ids = { resource: useId(), status: useId(), source: useId() };

  const dialogOpen = quick !== null || manual !== null || blocking;
  const dialogOpenRef = useRef(false);
  dialogOpenRef.current = dialogOpen;
  const latest = useRef({ locationId: day.locationId, date: day.date });
  latest.current = { locationId: day.locationId, date: day.date };

  /** Fetches the day again, so the grid shows what others have booked since. A failure keeps what is on screen. */
  const requests = useRef(0);
  const refresh = useCallback(async () => {
    const { locationId, date } = latest.current;
    const mine = ++requests.current;
    try {
      const res = await fetch(`/api/dashboard/availability?locationId=${encodeURIComponent(locationId)}&date=${encodeURIComponent(date)}`, { cache: "no-store" });
      if (res.status === 401) {
        toast.error("Your session has ended. Sign in again to continue.");
        return;
      }
      if (!res.ok) return;
      const fresh = (await res.json()) as DayView;
      // An older response that arrives late must not undo a newer one.
      if (mine === requests.current && fresh.locationId === latest.current.locationId && fresh.date === latest.current.date) setDay(fresh);
    } catch {
      /* offline: keep showing what we have */
    }
  }, []);

  // Keep the grid current while it is open, but never reshuffle it under an open dialog.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible" && !dialogOpenRef.current) void refresh();
    };
    const timer = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  const saved = () => {
    void refresh();
    router.refresh();
  };

  const axis = axisOf(day);
  const resources = day.resources.filter((r) => r.slots.length > 0 && (!resourceFilter || r.id === resourceFilter));
  const visible = day.bookings.filter((b) => (!statusFilter || b.status === statusFilter) && (!sourceFilter || b.source === sourceFilter));
  const filtered = !!(resourceFilter || statusFilter || sourceFilter);
  const canAdd = canCreate && writable;
  const anyOpen = day.resources.some((r) => openSlots(r, 1).length > 0);

  const addAt = (resourceId: string, startMinute: number) => {
    setQuick(null);
    setManual({ resourceId, startMinute });
  };

  if (!axis) {
    return (
      <p className="mt-6 rounded-card border bg-card p-5 text-[15px] text-muted-foreground">
        Nothing is open for booking on this day. Check the opening hours and any closures if that is not right.
      </p>
    );
  }

  return (
    <section aria-label="Day schedule" className="mt-5">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.resource} className="text-xs font-medium text-muted-foreground">
            Resource
          </label>
          <select id={ids.resource} value={resourceFilter} onChange={(e) => setResourceFilter(e.target.value)} className={SELECT}>
            <option value="">All resources</option>
            {day.resources
              .filter((r) => r.slots.length > 0)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.status} className="text-xs font-medium text-muted-foreground">
            Status
          </label>
          <select id={ids.status} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={SELECT}>
            <option value="">All statuses</option>
            {CALENDAR_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_WORD[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.source} className="text-xs font-medium text-muted-foreground">
            Source
          </label>
          <select id={ids.source} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className={SELECT}>
            <option value="">All sources</option>
            {(Object.keys(SOURCE_WORD) as (keyof typeof SOURCE_WORD)[]).map((s) => (
              <option key={s} value={s}>
                {SOURCE_WORD[s]}
              </option>
            ))}
          </select>
        </div>
        {filtered && (
          <Button
            type="button"
            variant="ghost"
            className="h-10 rounded-full px-3 text-primary"
            onClick={() => {
              setResourceFilter("");
              setStatusFilter("");
              setSourceFilter("");
            }}
          >
            Clear filters
          </Button>
        )}

        <div className="ml-auto flex flex-wrap gap-2">
          {canBlock && (
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-full px-4"
              disabled={!writable}
              title={writable ? undefined : READ_ONLY}
              onClick={() => {
                void refresh();
                setBlocking(true);
              }}
            >
              <Ban aria-hidden="true" />
              Block time
            </Button>
          )}
          {canCreate && (
            <Button
              type="button"
              className="h-10 rounded-full px-4"
              disabled={!writable || !anyOpen}
              title={writable ? (anyOpen ? undefined : "Nothing is free to book on this day.") : READ_ONLY}
              onClick={() => {
                void refresh();
                setManual("blank");
              }}
            >
              <Plus aria-hidden="true" />
              Add booking
            </Button>
          )}
        </div>
      </div>

      <Legend canAdd={canAdd} />

      <p className="mt-2 text-sm text-muted-foreground">
        Times in {timeZoneName(`${day.date}T12:00:00Z`, day.timezone)}.{" "}
        {filtered && (
          <span role="status">
            Showing {visible.length} of {day.bookings.length} {day.bookings.length === 1 ? "booking" : "bookings"} on exclusive resources.
          </span>
        )}
      </p>

      {resources.length === 0 ? (
        <p className="mt-4 rounded-card border bg-card p-5 text-[15px] text-muted-foreground">No resources match.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-card border bg-card [scrollbar-width:thin]">
          <div role="table" aria-label="Resources by time" className="w-max min-w-full">
            <TimeHeader axis={axis} />
            {resources.map((r) => (
              <Lane
                key={r.id}
                resource={r}
                axis={axis}
                day={day}
                bookings={visible}
                canAdd={canAdd}
                onFree={(s) => addAt(r.id, s.startMinute)}
                onBooking={(b) => setQuick({ kind: "booking", id: b.id })}
                onBlock={(b) => setQuick({ kind: "block", id: b.id })}
                onShared={(s) => setQuick({ kind: "slot", resourceId: r.id, startMinute: s.startMinute })}
              />
            ))}
          </div>
        </div>
      )}

      <QuickView
        target={quick}
        day={day}
        canCreate={canCreate}
        canBlock={canBlock}
        writable={writable}
        onClose={() => setQuick(null)}
        onAdd={addAt}
        onChanged={saved}
      />
      {canCreate && (
        <ManualBookingDialog
          open={manual !== null}
          onOpenChange={(o) => !o && setManual(null)}
          day={day}
          locationName={locationName}
          initial={manual && manual !== "blank" ? manual : null}
          onSaved={saved}
          onStale={() => void refresh()}
        />
      )}
      {canBlock && (
        <BlockDialog open={blocking} onOpenChange={setBlocking} day={day} locationName={locationName} onSaved={saved} onStale={() => void refresh()} />
      )}
    </section>
  );
}

function Legend({ canAdd }: { canAdd: boolean }) {
  return (
    <ul aria-label="Key" className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-3.5 rounded-sm border-l-4 border-l-success bg-success/15" />
        Confirmed
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-3.5 rounded-sm border-2 border-dashed border-warning bg-warning/10" />
        Pending, waiting for an answer
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-3.5 rounded-sm bg-muted" style={HATCH} />
        Blocked
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="flex size-3.5 items-center justify-center rounded-sm border text-[10px] leading-none">
          +
        </span>
        {canAdd ? "Free: click to add a booking" : "Free"}
      </li>
    </ul>
  );
}

const LABEL_W = "w-24 sm:w-36";

function TimeHeader({ axis }: { axis: Axis }) {
  return (
    <div role="row" className="flex border-b">
      <div role="columnheader" className={cn("sticky left-0 z-30 shrink-0 bg-card px-3 py-2 text-xs font-medium text-muted-foreground", LABEL_W)}>
        Resource
      </div>
      <div className="relative h-8 shrink-0" style={{ width: axisWidth(axis) }}>
        {hourTicks(axis).map((m) => (
          <span
            key={m}
            role="columnheader"
            className="tabular absolute top-0 flex h-full items-center border-l border-black/[0.07] pl-1.5 text-xs text-muted-foreground"
            style={{ left: (m - axis.start) * PX_PER_MINUTE }}
          >
            {minuteLabel(m)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Lane({
  resource: r,
  axis,
  day,
  bookings,
  canAdd,
  onFree,
  onBooking,
  onBlock,
  onShared,
}: {
  resource: ResourceView;
  axis: Axis;
  day: DayView;
  bookings: BookingView[];
  canAdd: boolean;
  onFree: (s: SlotView) => void;
  onBooking: (b: BookingView) => void;
  onBlock: (b: BlockView) => void;
  onShared: (s: SlotView) => void;
}) {
  const shared = r.bookingMode === "shared";
  const mine = bookings.filter((b) => b.resourceIds.includes(r.id));
  const blocks = day.blocks.filter((b) => b.resourceId === r.id);
  const tz = day.timezone;

  return (
    <div role="row" className="flex border-b last:border-b-0">
      <div role="rowheader" className={cn("sticky left-0 z-30 flex shrink-0 flex-col justify-center border-r bg-card px-3 py-2", LABEL_W)}>
        <span className="truncate text-sm font-medium" title={r.name}>
          {r.name}
        </span>
        {shared && <span className="tabular text-xs text-muted-foreground">{r.capacity} places</span>}
      </div>
      <div className="relative h-16 shrink-0" style={{ width: axisWidth(axis), ...gridLines }} role="cell">
        {r.slots.map((s) => {
          const at = place(axis, s.startMinute, s.endMinute);
          if (!at) return null;
          const box = { left: at.left + 2, width: Math.max(at.width - 4, 4) };
          const range = `${minuteLabel(s.startMinute)} to ${minuteLabel(s.endMinute)}`;
          if (shared) {
            const here = bookingsInSlot(day, r.id, s);
            const taken = placesTaken(here, r.id);
            const label = `${r.name}, ${range}: ${taken} of ${r.capacity} places taken`;
            const interactive = taken > 0 || (s.state === "available" && canAdd);
            const body = (
              <>
                <span className="tabular text-sm font-semibold">
                  {taken}/{r.capacity}
                </span>
                <span className="text-[11px] leading-tight text-muted-foreground">places taken</span>
                <span aria-hidden="true" className="mt-1 h-1 w-full overflow-hidden rounded-full bg-black/10">
                  <span className="block h-full rounded-full bg-info" style={{ width: `${Math.min(100, (taken / r.capacity) * 100)}%` }} />
                </span>
              </>
            );
            const cls = cn(
              "absolute inset-y-1 flex flex-col items-start justify-center rounded-lg border px-2 text-left",
              s.state === "blocked" || s.state === "unavailable" ? "bg-muted/60 text-muted-foreground" : "bg-card",
              interactive && "hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-1",
            );
            return interactive ? (
              <button key={`${s.startMinute}-${s.endMinute}`} type="button" aria-label={label} style={box} className={cls} onClick={() => (taken > 0 ? onShared(s) : onFree(s))}>
                {body}
              </button>
            ) : (
              <div key={`${s.startMinute}-${s.endMinute}`} role="img" aria-label={label} title={s.note} style={box} className={cls}>
                {body}
              </div>
            );
          }

          if (s.state === "available") {
            const label = `Add a booking: ${r.name}, ${range}`;
            return canAdd ? (
              <button
                key={`${s.startMinute}-${s.endMinute}`}
                type="button"
                aria-label={label}
                title={label}
                style={box}
                className="group absolute inset-y-1 flex items-center justify-center rounded-lg border border-black/10 bg-card text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-1"
                onClick={() => onFree(s)}
              >
                <Plus className="size-4 opacity-40 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
              </button>
            ) : (
              <div key={`${s.startMinute}-${s.endMinute}`} role="img" aria-label={`Free: ${r.name}, ${range}`} style={box} className="absolute inset-y-1 rounded-lg border border-black/10 bg-card" />
            );
          }
          // Taken, blocked or past: the booking or block drawn over it says which.
          return <div key={`${s.startMinute}-${s.endMinute}`} aria-hidden="true" title={s.note} style={box} className="absolute inset-y-1 rounded-lg bg-muted/50" />;
        })}

        {blocks.map((b) => {
          const at = place(axis, b.startMinute, b.endMinute);
          if (!at) return null;
          const label = `Blocked: ${r.name}, ${formatTime(b.startsAt, tz)} to ${formatTime(b.endsAt, tz)}${b.reason ? `, ${b.reason}` : ""}`;
          return (
            <button
              key={b.id}
              type="button"
              aria-label={label}
              title={label}
              onClick={() => onBlock(b)}
              style={{ left: at.left + 2, width: Math.max(at.width - 4, 4), ...HATCH }}
              className="absolute inset-y-1 z-10 flex items-center overflow-hidden rounded-lg border border-black/15 bg-muted px-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-1"
            >
              <span className="truncate rounded bg-card/85 px-1.5 py-0.5 text-xs font-medium">{b.reason ?? "Blocked"}</span>
            </button>
          );
        })}

        {!shared &&
          mine.map((b) => {
            const at = place(axis, b.startMinute, b.endMinute);
            if (!at) return null;
            const word = STATUS_WORD[b.status];
            const label = `${b.customerName}, ${word}, ${r.name}, ${formatTime(b.startsAt, tz)} to ${formatTime(b.endsAt, tz)}`;
            return (
              <button
                key={b.id}
                type="button"
                aria-label={label}
                title={`${label} · ${SOURCE_WORD[b.source]}`}
                onClick={() => onBooking(b)}
                style={{ left: at.left + 2, width: Math.max(at.width - 4, 4) }}
                className={cn(
                  "absolute inset-y-1 z-10 flex flex-col items-start justify-center overflow-hidden rounded-lg px-2 text-left shadow-xs focus-visible:outline-2 focus-visible:outline-offset-1",
                  BOOKING_LOOK[b.status] ?? BOOKING_LOOK.expired,
                )}
              >
                <span className="w-full truncate text-sm font-semibold leading-tight">{b.customerName}</span>
                <span className="w-full truncate text-[11px] leading-tight text-foreground/70">{word}</span>
              </button>
            );
          })}
      </div>
    </div>
  );
}
