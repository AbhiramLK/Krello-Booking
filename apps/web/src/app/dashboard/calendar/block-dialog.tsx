"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { localToInstant } from "@krello/booking-engine/time";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDayLong } from "@/lib/format";
import { blockResourceAction } from "./actions";
import { axisOf, parseTimeInput, timeInputValue } from "./geometry";
import type { DayView } from "./view-model";

const FIELD =
  "h-10 w-full rounded-md border border-input bg-card px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm";

export interface BlockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: DayView;
  locationName: string;
  onSaved: () => void;
  /** The grid is out of date (a conflict): fetch it again. */
  onStale: () => void;
}

/** Take a resource out of use for a period, for maintenance or a private event. */
export function BlockDialog(props: BlockDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Block time</DialogTitle>
          <DialogDescription>
            {props.locationName} · {formatDayLong(props.day.date)}. Customers cannot book a blocked resource. Cancel any bookings in the way first.
          </DialogDescription>
        </DialogHeader>
        <BlockForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function BlockForm({ onOpenChange, day, onSaved, onStale }: BlockDialogProps) {
  const ids = { resource: useId(), startDate: useId(), startTime: useId(), endDate: useId(), endTime: useId(), reason: useId(), err: useId() };
  const axis = axisOf(day);
  const firstHour = axis?.start ?? 10 * 60;

  const [resourceId, setResourceId] = useState(day.resources[0]?.id ?? "");
  const [startDate, setStartDate] = useState(day.date);
  const [startTime, setStartTime] = useState(timeInputValue(firstHour));
  const [endDate, setEndDate] = useState(day.date);
  const [endTime, setEndTime] = useState(timeInputValue(firstHour + 60));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const from = parseTimeInput(startTime);
    const to = parseTimeInput(endTime);
    if (!resourceId) return setError("Choose what to block.");
    if (from === null || to === null || !startDate || !endDate) return setError("Enter when the block starts and ends.");
    // The venue's own timezone, not the browser's.
    const startsAt = localToInstant(startDate, from, day.timezone);
    const endsAt = localToInstant(endDate, to, day.timezone);
    if (endsAt.getTime() <= startsAt.getTime()) return setError("The block must end after it starts.");

    setSaving(true);
    try {
      const result = await blockResourceAction({ resourceId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), reason });
      if (!result.ok) {
        setError(result.message);
        // Bookings in the way, or something changed: show what is on the calendar now.
        if (result.code === "slot_conflict" || result.code === "not_found") onStale();
        return;
      }
      toast.success("Time blocked");
      onSaved();
      onOpenChange(false);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.resource}>What to block</Label>
        <select id={ids.resource} value={resourceId} disabled={saving} className={FIELD} onChange={(e) => setResourceId(e.target.value)}>
          {day.resources.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.startDate}>From date</Label>
          <Input id={ids.startDate} type="date" value={startDate} disabled={saving} onChange={(e) => setStartDate(e.target.value)} className="tabular h-10 bg-card" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.startTime}>From time</Label>
          <Input id={ids.startTime} type="time" value={startTime} disabled={saving} onChange={(e) => setStartTime(e.target.value)} className="tabular h-10 bg-card" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.endDate}>Until date</Label>
          <Input id={ids.endDate} type="date" value={endDate} disabled={saving} onChange={(e) => setEndDate(e.target.value)} className="tabular h-10 bg-card" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.endTime}>Until time</Label>
          <Input id={ids.endTime} type="time" value={endTime} disabled={saving} onChange={(e) => setEndTime(e.target.value)} className="tabular h-10 bg-card" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.reason}>Reason (optional)</Label>
        <Input
          id={ids.reason}
          value={reason}
          maxLength={200}
          disabled={saving}
          placeholder="Cloth change, private event…"
          onChange={(e) => setReason(e.target.value)}
          className="h-10 bg-card"
        />
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
        <Button type="submit" className="h-10 rounded-full px-5" disabled={saving}>
          {saving ? "Blocking…" : "Block time"}
        </Button>
      </DialogFooter>
    </form>
  );
}
