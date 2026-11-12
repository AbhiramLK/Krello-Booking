"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Banknote, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action";
import { formatInr, rupeesInput } from "@/lib/format";
import { newKey } from "@/lib/new-key";
import { recordPaymentAction } from "../../payments/actions";

type Kind = "collection" | "refund";

const selectClass =
  "h-10 w-full rounded-xl border border-input bg-card px-3 text-[15px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

const COPY: Record<Kind, { submit: string; busy: string; done: string; amountHint: (max: number) => string }> = {
  collection: {
    submit: "Record payment",
    busy: "Recording…",
    done: "Payment recorded",
    amountHint: (due) => `Up to ${formatInr(due)}, the amount still due.`,
  },
  refund: {
    submit: "Record refund",
    busy: "Recording…",
    done: "Refund recorded",
    amountHint: (collected) => `Up to ${formatInr(collected)}, the amount collected so far.`,
  },
};

/** Failures that mean the amounts changed under us: show the message and the current figures. */
const STALE = new Set(["payment_exceeds_due", "not_found", "invalid_transition"]);

interface EntryProps {
  bookingId: string;
  kind: Kind;
  /** Paise: the most this entry may be, and what the field starts as. */
  max: number;
  disabled: boolean;
  onDone?: () => void;
}

/**
 * One payment or refund entry. Its idempotency key lives for one attempt: a
 * retry of the same details (a dropped connection, a double click) reuses it
 * and records once, while any edit starts a new attempt.
 */
function EntryForm({ bookingId, kind, max, disabled, onDone }: EntryProps) {
  const router = useRouter();
  const [amount, setAmount] = useState(kind === "collection" ? rupeesInput(max) : "");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const attempt = useRef<string | null>(null);
  const uid = useId();
  const copy = COPY[kind];
  const errorId = `${uid}-error`;

  /** Any change to the details makes the next submit a new attempt. */
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    attempt.current = null;
    setError(null);
    set(v);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    if (!amount.trim()) {
      setError("Enter an amount in rupees, like 150 or 150.50.");
      return;
    }
    attempt.current ??= newKey();
    setSaving(true);
    let result: ActionResult<{ replayed: boolean }>;
    try {
      result = await recordPaymentAction({
        bookingId,
        kind,
        amountRupees: amount,
        method,
        reference: reference || undefined,
        notes: notes || undefined,
        idempotencyKey: attempt.current,
      });
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
      setSaving(false);
      return;
    }
    setSaving(false);
    if (!result.ok) {
      if (STALE.has(result.code)) {
        toast.error(result.message);
        router.refresh();
      } else {
        // A rejected attempt recorded nothing, so the next try is a fresh one.
        attempt.current = null;
        setError(result.message);
      }
      return;
    }
    attempt.current = null;
    toast.success(result.data.replayed ? "That was already recorded" : copy.done);
    router.refresh();
    onDone?.();
  }

  const locked = disabled || saving;
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-amount`}>Amount (₹)</Label>
        <Input
          id={`${uid}-amount`}
          value={amount}
          onChange={(e) => edit(setAmount)(e.target.value)}
          inputMode="decimal"
          autoComplete="off"
          maxLength={12}
          disabled={locked}
          className="tabular h-10 rounded-xl bg-card"
          aria-describedby={error ? `${uid}-hint ${errorId}` : `${uid}-hint`}
          aria-invalid={error ? true : undefined}
        />
        <p id={`${uid}-hint`} className="tabular text-sm text-muted-foreground">
          {copy.amountHint(max)}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-method`}>{kind === "refund" ? "Returned by" : "Paid by"}</Label>
        <select id={`${uid}-method`} value={method} onChange={(e) => edit(setMethod)(e.target.value)} disabled={locked} className={selectClass}>
          <option value="cash">Cash</option>
          <option value="upi">UPI</option>
          <option value="card">Card</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-reference`}>Reference (optional)</Label>
        <Input
          id={`${uid}-reference`}
          value={reference}
          onChange={(e) => edit(setReference)(e.target.value)}
          maxLength={100}
          autoComplete="off"
          placeholder="UPI transaction id or receipt number"
          disabled={locked}
          className="h-10 rounded-xl bg-card"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-notes`}>{kind === "refund" ? "Reason (optional)" : "Note (optional)"}</Label>
        <Textarea id={`${uid}-notes`} value={notes} onChange={(e) => edit(setNotes)(e.target.value)} maxLength={500} rows={2} disabled={locked} />
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm text-[#c4271d]">
          {error}
        </p>
      )}
      <Button type="submit" disabled={locked} className="h-10 self-start rounded-full px-5">
        {saving ? copy.busy : copy.submit}
      </Button>
    </form>
  );
}

export interface PaymentFormProps {
  bookingId: string;
  /** Paise still due, from the server. The server re-checks it under a lock. */
  due: number;
  /** Paise collected so far. */
  collected: number;
  /** The booking is confirmed, so money can be taken against it. */
  collectible: boolean;
  canRecord: boolean;
  canRefund: boolean;
  /** True while the account is read-only. */
  disabled: boolean;
}

/**
 * Takes money recorded at the venue against a booking, and hands it back.
 * The refund is a separate, secondary action shown only to members allowed to
 * make one. Both forms are rebuilt whenever the booking's figures change, so
 * the prefilled amount is always the amount still due.
 */
export function PaymentForm({ bookingId, due, collected, collectible, canRecord, canRefund, disabled }: PaymentFormProps) {
  const [refunding, setRefunding] = useState(false);
  const showRefund = canRefund && collected > 0;
  if (!canRecord && !showRefund) return null;

  return (
    <div className="mt-5 border-t pt-5">
      {canRecord &&
        (collectible && due > 0 ? (
          <>
            <h3 className="flex items-center gap-2 text-[17px] font-semibold">
              <Banknote className="size-4.5 text-muted-foreground" aria-hidden="true" />
              Record a payment
            </h3>
            <p className="mt-1 mb-3 text-sm text-muted-foreground">Customers pay at the venue. Record what you have just taken.</p>
            <EntryForm key={`collect-${collected}`} bookingId={bookingId} kind="collection" max={due} disabled={disabled} />
          </>
        ) : (
          <p className="text-[15px] text-muted-foreground">
            {collectible ? "Paid in full. There is nothing more to collect." : "Payments can be recorded once the booking is confirmed."}
          </p>
        ))}

      {showRefund && (
        <div className={canRecord ? "mt-5" : undefined}>
          <Button type="button" variant="outline" disabled={disabled} onClick={() => setRefunding(true)} className="h-10 rounded-full px-4">
            <Undo2 aria-hidden="true" />
            Record a refund
          </Button>
          <Dialog open={refunding} onOpenChange={setRefunding}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Record a refund</DialogTitle>
                <DialogDescription>
                  Use this when money is handed back. Entries are never edited: a mistake is corrected with another entry.
                </DialogDescription>
              </DialogHeader>
              <EntryForm
                key={`refund-${collected}-${refunding}`}
                bookingId={bookingId}
                kind="refund"
                max={collected}
                disabled={disabled}
                onDone={() => setRefunding(false)}
              />
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
}
