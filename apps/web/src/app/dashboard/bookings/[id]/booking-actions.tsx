"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Check, CheckCheck, UserX, X, type LucideIcon } from "lucide-react";
import type { DecisionAction } from "@krello/core";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action";
import { cn } from "@/lib/utils";
import { addNoteAction, decideBookingAction } from "../../actions";

const BUTTON: Record<DecisionAction, { label: string; busy: string; done: string; icon: LucideIcon; variant: "default" | "outline" }> = {
  approve: { label: "Approve", busy: "Approving…", done: "Request approved", icon: Check, variant: "default" },
  reject: { label: "Decline", busy: "Declining…", done: "Request declined", icon: X, variant: "outline" },
  complete: { label: "Mark completed", busy: "Saving…", done: "Marked completed", icon: CheckCheck, variant: "default" },
  no_show: { label: "No-show", busy: "Saving…", done: "Marked as a no-show", icon: UserX, variant: "outline" },
  cancel_by_business: { label: "Cancel booking", busy: "Cancelling…", done: "Booking cancelled", icon: Ban, variant: "outline" },
};

/** Failures that mean the booking changed under us: show the message and the current state. */
const STALE = new Set(["invalid_transition", "slot_conflict", "not_found"]);

const NEEDS_REASON: Partial<Record<DecisionAction, { title: string; description: string; confirm: string }>> = {
  reject: {
    title: "Decline this request?",
    description: "The customer sees your reason, and the slot is released for others.",
    confirm: "Decline request",
  },
  cancel_by_business: {
    title: "Cancel this booking?",
    description: "The customer is told the venue cancelled, with your reason, and the slot is released.",
    confirm: "Cancel booking",
  },
};

export interface BookingActionsProps {
  bookingId: string;
  /** Computed on the server from the member's role, the status and the time. */
  actions: DecisionAction[];
  /** True while the account is read-only. */
  disabled: boolean;
  customerName: string;
  className?: string;
}

/**
 * The decisions available on a booking. Approve, complete and no-show are one
 * click; declining and cancelling ask for a reason first.
 */
export function BookingActions({ bookingId, actions, disabled, customerName, className }: BookingActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<DecisionAction | null>(null);
  const [dialog, setDialog] = useState<DecisionAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const reasonId = useId();
  const reasonErrorId = useId();

  if (!actions.length) return null;

  async function run(action: DecisionAction, why?: string): Promise<boolean> {
    setBusy(action);
    let result: ActionResult<{ status: string }>;
    try {
      result = await decideBookingAction({ bookingId, action, reason: why });
    } catch {
      toast.error("We could not reach the server. Check your connection and try again.");
      setBusy(null);
      return false;
    }
    setBusy(null);
    if (!result.ok) {
      if (STALE.has(result.code)) {
        toast.error(result.message);
        router.refresh();
        setDialog(null);
      } else if (dialog) {
        setReasonError(result.message);
      } else {
        toast.error(result.message);
      }
      return false;
    }
    toast.success(BUTTON[action].done);
    router.refresh();
    return true;
  }

  async function confirmWithReason() {
    if (!dialog) return;
    setReasonError(null);
    if (!reason.trim()) {
      setReasonError(dialog === "reject" ? "Give a reason for declining." : "Give a reason for cancelling.");
      return;
    }
    if (await run(dialog, reason.trim())) {
      setDialog(null);
      setReason("");
    }
  }

  const copy = dialog ? NEEDS_REASON[dialog] : undefined;
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {actions.map((action) => {
        const b = BUTTON[action];
        const Icon = b.icon;
        return (
          <Button
            key={action}
            type="button"
            variant={b.variant}
            disabled={disabled || busy !== null}
            title={disabled ? "Read-only: renew the subscription to manage bookings." : undefined}
            onClick={() => {
              if (NEEDS_REASON[action]) {
                setReason("");
                setReasonError(null);
                setDialog(action);
              } else {
                void run(action);
              }
            }}
            className={cn("h-10 rounded-full px-4", action === "cancel_by_business" && "text-[#c4271d]")}
          >
            <Icon aria-hidden="true" />
            {busy === action && !dialog ? b.busy : b.label}
            {action === "approve" && <span className="sr-only"> request from {customerName}</span>}
          </Button>
        );
      })}

      <Dialog open={dialog !== null} onOpenChange={(o) => !busy && !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{copy?.title}</DialogTitle>
            <DialogDescription>{copy?.description}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={reasonId}>Reason</Label>
            <Textarea
              id={reasonId}
              value={reason}
              maxLength={500}
              rows={3}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy !== null}
              aria-required
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonError ? reasonErrorId : undefined}
            />
            {reasonError && (
              <p id={reasonErrorId} role="alert" className="text-sm text-[#c4271d]">
                {reasonError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-full" disabled={busy !== null} onClick={() => setDialog(null)}>
              Go back
            </Button>
            <Button type="button" variant="destructive" className="rounded-full" disabled={busy !== null} onClick={() => void confirmWithReason()}>
              {busy ? (dialog ? BUTTON[dialog].busy : "") : copy?.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Adds an internal note to a booking. Notes are for the venue's team and never reach the customer. */
export function AddNoteForm({ bookingId, disabled }: { bookingId: string; disabled: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = useId();
  const errorId = useId();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!note.trim()) {
      setError("Write a note first.");
      return;
    }
    setSaving(true);
    try {
      const result = await addNoteAction({ bookingId, note });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setNote("");
      toast.success("Note added");
      router.refresh();
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="mt-4 flex flex-col gap-2">
      <Label htmlFor={id}>Add a note</Label>
      <Textarea
        id={id}
        value={note}
        maxLength={1000}
        rows={2}
        onChange={(e) => setNote(e.target.value)}
        disabled={disabled || saving}
        placeholder="Only your team sees this"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <p id={errorId} role="alert" className="text-sm text-[#c4271d]">
          {error}
        </p>
      )}
      <Button type="submit" variant="outline" className="h-10 self-start rounded-full px-4" disabled={disabled || saving}>
        {saving ? "Saving…" : "Add note"}
      </Button>
    </form>
  );
}
