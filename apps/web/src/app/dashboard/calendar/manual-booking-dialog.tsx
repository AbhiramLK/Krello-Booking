"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { durationLabel, formatDayLong, formatInr, minuteLabel } from "@/lib/format";
import { newKey } from "@/lib/new-key";
import { cn } from "@/lib/utils";
import { createManualBookingAction, quoteManualBookingAction } from "./actions";
import { chainFrom, openSlots } from "./geometry";
import type { DayView, ResourceView } from "./view-model";

const FIELD =
  "h-10 w-full rounded-md border border-input bg-card px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm";

type Source = "phone" | "walk_in" | "admin";
const SOURCES: { value: Source; label: string }[] = [
  { value: "phone", label: "Phone" },
  { value: "walk_in", label: "Walk-in" },
  { value: "admin", label: "Added by venue" },
];

type Quote =
  | { status: "idle" }
  | { status: "loading"; key: string }
  | { status: "ready"; key: string; total: number; lines: { resourceId: string; name: string; amount: number }[] }
  | { status: "error"; key: string; message: string };

/** How soon a slot starts, for choosing a sensible default source: a booking about to start is a walk-in. */
const WALK_IN_WINDOW_MS = 2 * 60 * 60_000;

export interface ManualBookingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: DayView;
  locationName: string;
  /** The slot clicked on the grid, if any. */
  initial: { resourceId: string; startMinute: number } | null;
  /** The booking was saved. */
  onSaved: () => void;
  /** The grid is out of date (a conflict): fetch it again. */
  onStale: () => void;
}

/**
 * Enter a phone, walk-in or venue-added booking. The price for the chosen
 * slots is worked out by the server before anything is saved, and the booking
 * can run over several back-to-back slots. The form mounts fresh each time the
 * dialog opens, so nothing is carried over from the last booking.
 */
export function ManualBookingDialog(props: ManualBookingDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a booking</DialogTitle>
          <DialogDescription>
            {props.locationName} · {formatDayLong(props.day.date)}
          </DialogDescription>
        </DialogHeader>
        <ManualBookingForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function ManualBookingForm({ onOpenChange, day, initial, onSaved, onStale }: ManualBookingDialogProps) {
  const ids = { resource: useId(), start: useId(), length: useId(), people: useId(), name: useId(), phone: useId(), notes: useId(), err: useId(), phoneErr: useId(), peopleErr: useId(), notesHint: useId() };

  const withSlots = day.resources.filter((r) => r.slots.length > 0);
  const [resourceId, setResourceId] = useState(() => initial?.resourceId ?? withSlots.find((r) => openSlots(r, 1).length > 0)?.id ?? withSlots[0]?.id ?? "");
  const resource: ResourceView | undefined = day.resources.find((r) => r.id === resourceId);
  const [startPick, setStartPick] = useState<number | null>(initial?.startMinute ?? null);
  const [count, setCount] = useState(1);
  const [people, setPeople] = useState(() => (resource?.bookingMode === "shared" ? "1" : "2"));
  const [source, setSource] = useState<Source>(() => {
    const first = resource?.slots.find((s) => s.startMinute === initial?.startMinute);
    return first && new Date(first.startsAt).getTime() - Date.now() < WALK_IN_WINDOW_MS ? "walk_in" : "phone";
  });
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [quote, setQuote] = useState<Quote>({ status: "idle" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const groupSize = /^\d+$/.test(people.trim()) ? Number(people.trim()) : 0;
  const peopleOk = groupSize >= 1 && groupSize <= 500;

  // Open slots, plus the one picked even if it has since been taken, so a refresh
  // after a conflict does not silently swap the user to another time.
  const open = useMemo(() => (resource ? openSlots(resource, peopleOk ? groupSize : 1) : []), [resource, peopleOk, groupSize]);
  const pickedExists = resource?.slots.some((s) => s.startMinute === startPick) ?? false;
  const start = startPick !== null && pickedExists ? startPick : (open[0]?.startMinute ?? null);
  const chain = useMemo(() => (resource && start !== null ? chainFrom(resource, start, peopleOk ? groupSize : 1) : []), [resource, start, peopleOk, groupSize]);
  const length = Math.min(count, chain.length);
  const span = chain.length ? { first: chain[0]!, last: chain[length - 1]! } : null;
  const startsAt = span?.first.startsAt;
  const endsAt = span?.last.endsAt;
  const quoteKey = resource && startsAt && endsAt && peopleOk ? `${resource.id}|${startsAt}|${endsAt}|${groupSize}` : null;

  useEffect(() => {
    if (!quoteKey || !resource || !startsAt || !endsAt) {
      setQuote({ status: "idle" });
      return;
    }
    let current = true;
    setQuote({ status: "loading", key: quoteKey });
    const timer = setTimeout(async () => {
      try {
        const result = await quoteManualBookingAction({ locationId: day.locationId, resourceIds: [resource.id], startsAt, endsAt, groupSize });
        if (!current) return;
        setQuote(result.ok ? { status: "ready", key: quoteKey, total: result.data.total, lines: result.data.lines } : { status: "error", key: quoteKey, message: result.message });
        if (!result.ok && result.code === "slot_conflict") onStale();
      } catch {
        if (current) setQuote({ status: "error", key: quoteKey, message: "We could not work out the price. Check your connection and try again." });
      }
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // The key stands for the whole selection; the other values are what it was made from.
  }, [quoteKey]);

  // A retry of the same booking reuses its key, so it can never be saved twice;
  // changing anything makes it a different booking and gets a fresh key.
  const attempt = useRef<{ signature: string; key: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPhoneError(null);
    setNameError(null);
    if (!resource || !startsAt || !endsAt || !peopleOk) {
      setError("Choose a free time and how many people first.");
      return;
    }
    if (source !== "walk_in" && !name.trim()) {
      setNameError("Enter the customer's name.");
      return;
    }
    const body = { locationId: day.locationId, resourceIds: [resource.id], startsAt, endsAt, source, name, phone, groupSize, notes };
    const signature = JSON.stringify(body);
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: newKey() };

    setSaving(true);
    try {
      const result = await createManualBookingAction({ ...body, idempotencyKey: attempt.current.key });
      if (!result.ok) {
        if (result.code === "invalid_phone") setPhoneError(result.message);
        else setError(result.message);
        // Someone else took the slot, or it changed: show what is there now.
        if (result.code === "slot_conflict" || result.code === "not_found") onStale();
        return;
      }
      attempt.current = null;
      toast.success(`Booking added for ${name.trim() || "Walk-in"} · ${result.data.reference}`);
      onSaved();
      onOpenChange(false);
    } catch {
      setError("We could not reach the server. Check your connection and try again. Your booking has not been lost if you try again.");
    } finally {
      setSaving(false);
    }
  }

  const quoted = quote.status === "ready" && quote.key === quoteKey ? quote : null;
  const canSave = !!quoted && !saving;
  const noSlots = !!resource && open.length === 0 && !pickedExists;

  return (
    <form onSubmit={(e) => void save(e)} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={ids.resource}>What to book</Label>
          <select
            id={ids.resource}
            value={resourceId}
            disabled={saving}
            className={FIELD}
            onChange={(e) => {
              setResourceId(e.target.value);
              setStartPick(null);
              setCount(1);
            }}
          >
            {withSlots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.bookingMode === "shared" ? ` (${r.capacity} places)` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.start}>Starts</Label>
          <select
            id={ids.start}
            value={start ?? ""}
            disabled={saving || !resource}
            className={FIELD}
            onChange={(e) => {
              setStartPick(Number(e.target.value));
              setCount(1);
            }}
          >
            {pickedExists && !open.some((s) => s.startMinute === start) && start !== null && (
              <option value={start}>{minuteLabel(start)} (no longer free)</option>
            )}
            {open.map((s) => (
              <option key={s.startMinute} value={s.startMinute}>
                {minuteLabel(s.startMinute)}
                {s.startMinute >= 1440 ? " (next day)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.length}>For how long</Label>
          <select id={ids.length} value={length} disabled={saving || chain.length === 0} className={FIELD} onChange={(e) => setCount(Number(e.target.value))}>
            {chain.map((s, i) => (
              <option key={s.startMinute} value={i + 1}>
                {durationLabel(s.endMinute - chain[0]!.startMinute)} · until {minuteLabel(s.endMinute)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {noSlots && (
        <p role="status" className="rounded-2xl bg-muted/60 p-3 text-sm">
          Nothing is free on {resource?.name} for {peopleOk ? `${groupSize} ${groupSize === 1 ? "person" : "people"}` : "this day"}. Choose something else.
        </p>
      )}

      <fieldset className="flex flex-col gap-1.5" disabled={saving}>
        <legend className="mb-1.5 text-sm font-medium">How it came in</legend>
        <div className="flex rounded-full bg-muted p-1">
          {SOURCES.map((s) => (
            <label
              key={s.value}
              className={cn(
                "flex h-8 flex-1 cursor-pointer items-center justify-center whitespace-nowrap rounded-full px-2 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
                source === s.value ? "bg-card shadow-xs" : "text-muted-foreground",
              )}
            >
              <input type="radio" name="source" value={s.value} checked={source === s.value} onChange={() => setSource(s.value)} className="sr-only" />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.name}>Customer name</Label>
          <Input
            id={ids.name}
            value={name}
            maxLength={120}
            disabled={saving}
            placeholder={source === "walk_in" ? "Walk-in" : undefined}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
            aria-required={source !== "walk_in"}
            aria-invalid={nameError ? true : undefined}
            className="h-10 bg-card"
          />
          {nameError && (
            <p role="alert" className="text-sm text-[#c4271d]">
              {nameError}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.phone}>Phone (optional)</Label>
          <Input
            id={ids.phone}
            type="tel"
            inputMode="tel"
            value={phone}
            maxLength={32}
            disabled={saving}
            placeholder="98765 43210"
            autoComplete="off"
            onChange={(e) => setPhone(e.target.value)}
            aria-invalid={phoneError ? true : undefined}
            aria-describedby={phoneError ? ids.phoneErr : undefined}
            className="h-10 bg-card"
          />
          {phoneError && (
            <p id={ids.phoneErr} role="alert" className="text-sm text-[#c4271d]">
              {phoneError}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[7rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.people}>People</Label>
          <Input
            id={ids.people}
            inputMode="numeric"
            value={people}
            disabled={saving}
            onChange={(e) => setPeople(e.target.value)}
            aria-invalid={!peopleOk ? true : undefined}
            aria-describedby={!peopleOk ? ids.peopleErr : undefined}
            className="h-10 bg-card"
          />
          {!peopleOk && (
            <p id={ids.peopleErr} className="text-sm text-[#c4271d]">
              From 1 to 500.
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.notes}>Customer&apos;s notes (optional)</Label>
          <Textarea
            id={ids.notes}
            value={notes}
            maxLength={500}
            rows={2}
            disabled={saving}
            onChange={(e) => setNotes(e.target.value)}
            aria-describedby={ids.notesHint}
            className="bg-card"
          />
          <p id={ids.notesHint} className="text-xs text-muted-foreground">
            What the customer asked for. Your own remarks go in Notes on the booking page.
          </p>
        </div>
      </div>

      <div className="rounded-2xl bg-muted/60 p-4" aria-live="polite">
        <p className="text-sm text-muted-foreground">Booking total</p>
        {quoted ? (
          <>
            <p className="tabular text-2xl font-semibold tracking-tight">{formatInr(quoted.total)}</p>
            {quoted.lines.length > 1 && (
              <ul className="tabular mt-1 text-sm text-muted-foreground">
                {quoted.lines.map((l) => (
                  <li key={l.resourceId}>
                    {l.name}: {formatInr(l.amount)}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-sm text-muted-foreground">Payment is recorded separately, on the booking.</p>
          </>
        ) : quote.status === "error" && quote.key === quoteKey ? (
          <p role="alert" className="text-[15px] text-[#c4271d]">
            {quote.message}
          </p>
        ) : quote.status === "loading" ? (
          <p className="text-[15px] text-muted-foreground">Working out the price…</p>
        ) : (
          <p className="text-[15px] text-muted-foreground">Choose a free time to see the price.</p>
        )}
      </div>

      {error && (
        <p id={ids.err} role="alert" className="rounded-2xl bg-destructive/10 p-3 text-[15px] text-[#c4271d]">
          {error}
        </p>
      )}

      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="outline" className="h-10 rounded-full px-5" disabled={saving} onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" className="h-10 rounded-full px-5" disabled={!canSave}>
          {saving ? "Saving…" : "Save booking"}
        </Button>
      </DialogFooter>
    </form>
  );
}
