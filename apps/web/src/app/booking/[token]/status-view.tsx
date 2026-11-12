"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, CheckCheck, CircleCheck, CircleX, Hourglass, Phone, UserX, type LucideIcon } from "lucide-react";
import { STATUS_LABEL, type BookingStatus } from "@krello/booking-engine/labels";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { countdown, formatDay, formatInr, formatRange, formatTime, timeZoneName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cancelBookingAction } from "./actions";

/** What the status page shows. Built on the server from the customer view only. */
export interface StatusBooking {
  reference: string;
  status: BookingStatus;
  customerName: string;
  groupSize: number;
  startsAt: string;
  endsAt: string;
  pendingExpiresAt: string | null;
  rejectionReason: string | null;
  cancellationReason: string | null;
  totalAmount: number;
  venue: { name: string; slug: string; phone: string | null; locationName: string; address: string; timezone: string };
  items: { name: string; type: string; units: number }[];
  canCancel: boolean;
  cancelDeadline: string | null;
  cancellationReasonRequired: boolean;
}

const POLL_MS = 15_000;

const LOOK: Record<BookingStatus, { icon: LucideIcon; tone: string; lead: string }> = {
  pending: { icon: Hourglass, tone: "bg-warning/15 text-[#8a5300]", lead: "Your request has been sent. The venue has not confirmed it yet." },
  approved: { icon: CircleCheck, tone: "bg-success/15 text-[#1b7a35]", lead: "The venue has confirmed your booking." },
  rejected: { icon: CircleX, tone: "bg-destructive/10 text-[#c4271d]", lead: "The venue could not accept this request." },
  expired: { icon: Ban, tone: "bg-muted text-muted-foreground", lead: "The venue did not respond in time, so the request expired." },
  cancelled_by_customer: { icon: Ban, tone: "bg-muted text-muted-foreground", lead: "You cancelled this booking." },
  cancelled_by_business: { icon: Ban, tone: "bg-destructive/10 text-[#c4271d]", lead: "The venue cancelled this booking." },
  completed: { icon: CheckCheck, tone: "bg-info/10 text-[#0058b0]", lead: "Thanks for visiting." },
  no_show: { icon: UserX, tone: "bg-destructive/10 text-[#c4271d]", lead: "The venue marked this booking as a no-show." },
};

/** Ended without being used, so the slot went back on sale. */
const RELEASED: BookingStatus[] = ["rejected", "expired", "cancelled_by_customer", "cancelled_by_business"];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-3 text-[15px] sm:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export function StatusView({ token, booking: b }: { token: string; booking: StatusBooking }) {
  const router = useRouter();
  const tz = b.venue.timezone;
  const look = LOOK[b.status];
  const Icon = look.icon;
  const pending = b.status === "pending";

  /* ---------- live countdown and polling while pending ---------- */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [pending]);

  const last = useRef({ status: b.status, canCancel: b.canCancel });
  last.current = { status: b.status, canCancel: b.canCancel };
  useEffect(() => {
    if (!pending) return;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/booking-status/${encodeURIComponent(token)}`, { cache: "no-store" });
        if (stopped) return;
        if (res.status === 404) return router.refresh();
        if (!res.ok) return;
        const next = (await res.json()) as { status: BookingStatus; canCancel: boolean };
        if (next.status !== last.current.status || next.canCancel !== last.current.canCancel) router.refresh();
      } catch {
        // Offline for a moment: the next poll tries again.
      }
    };
    const id = setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, [pending, token, router]);

  // When the deadline passes, ask the server; it records the expiry and releases the slot.
  const deadline = b.pendingExpiresAt ? new Date(b.pendingExpiresAt) : null;
  const overdue = pending && deadline !== null && deadline.getTime() <= now.getTime();
  useEffect(() => {
    if (overdue) router.refresh();
  }, [overdue, router]);

  /* ---------- cancelling ---------- */
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const reasonId = useId();
  const reasonErrorId = useId();

  async function cancel() {
    setReasonError(null);
    if (b.cancellationReasonRequired && !reason.trim()) {
      setReasonError("Please say why you are cancelling.");
      return;
    }
    setCancelling(true);
    try {
      const result = await cancelBookingAction({ token, reason: reason.trim() || undefined });
      if (!result.ok) {
        setReasonError(result.message);
        return;
      }
      setOpen(false);
      toast.success(pending ? "Request cancelled" : "Booking cancelled");
      router.refresh();
    } catch {
      setReasonError("We could not reach the server. Check your connection and try again.");
    } finally {
      setCancelling(false);
    }
  }

  const venueHref = `/${b.venue.slug}`;
  const phoneHref = b.venue.phone ? `tel:${b.venue.phone.replace(/[^+\d]/g, "")}` : null;

  return (
    <article aria-labelledby="status-heading">
      <p className="text-sm font-medium text-muted-foreground">
        Booking <span className="tabular">{b.reference}</span>
      </p>
      <div className="mt-3 flex items-start gap-4">
        <span className={cn("flex size-14 shrink-0 items-center justify-center rounded-2xl", look.tone)} aria-hidden="true">
          <Icon className="size-7" />
        </span>
        <div className="min-w-0">
          <h1 id="status-heading" className="text-3xl font-semibold tracking-tight" data-status={b.status}>
            {STATUS_LABEL[b.status]}
          </h1>
          <p className="mt-1 text-muted-foreground">{look.lead}</p>
        </div>
      </div>

      {pending && deadline && (
        <div className="mt-6 rounded-card border bg-card p-5" role="timer" aria-live="off">
          <p className="tabular text-4xl font-semibold tracking-tight">{countdown(deadline, now)}</p>
          <p className="mt-1 text-[15px]">The venue has until {formatTime(deadline, tz)} to respond.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Your slot is held until then. This is a request: it is confirmed only when the venue approves it. This page updates by itself.
          </p>
        </div>
      )}

      {b.status === "rejected" && b.rejectionReason && (
        <p className="mt-6 rounded-2xl bg-card p-4 text-[15px]">
          <span className="font-medium">Reason from the venue:</span> {b.rejectionReason}
        </p>
      )}
      {(b.status === "cancelled_by_business" || b.status === "cancelled_by_customer") && b.cancellationReason && (
        <p className="mt-6 rounded-2xl bg-card p-4 text-[15px]">
          <span className="font-medium">Reason for cancelling:</span> {b.cancellationReason}
        </p>
      )}
      {RELEASED.includes(b.status) && (
        <p className="mt-4 text-[15px]">
          The slot is open for others again.{" "}
          <Link href={venueHref} className="font-medium text-primary hover:underline">
            Book another time
          </Link>
        </p>
      )}

      <dl className="mt-6 divide-y rounded-card border bg-card px-5">
        <Row label="Venue">
          <Link href={venueHref} className="font-medium hover:underline">
            {b.venue.name}
          </Link>
          {b.venue.locationName && b.venue.locationName !== b.venue.name && <span className="text-muted-foreground">, {b.venue.locationName}</span>}
        </Row>
        <Row label="Address">{b.venue.address}</Row>
        <Row label="When">
          <span className="tabular">{formatRange(b.startsAt, b.endsAt, tz)}</span>
          <span className="block text-sm text-muted-foreground">{timeZoneName(b.startsAt, tz)}</span>
        </Row>
        <Row label="Booked">
          <ul>
            {b.items.map((item) => (
              <li key={item.name}>
                {item.name}
                {item.units > 1 && <span className="tabular text-muted-foreground"> × {item.units} places</span>}
              </li>
            ))}
          </ul>
        </Row>
        <Row label="People">
          <span className="tabular">{b.groupSize}</span>
        </Row>
        <Row label="Name">{b.customerName}</Row>
        <Row label="Total">
          <span className="tabular font-semibold">{formatInr(b.totalAmount)}</span>
          <span className="block text-sm text-muted-foreground">Pay at the venue</span>
        </Row>
      </dl>

      <div className="mt-6 flex flex-wrap gap-3">
        {phoneHref && (
          <Button asChild variant="outline" size="lg" className="h-11 rounded-full">
            <a href={phoneHref}>
              <Phone />
              Call {b.venue.phone}
            </a>
          </Button>
        )}
        {b.canCancel && (
          <Button type="button" variant="outline" size="lg" className="h-11 rounded-full text-[#c4271d]" onClick={() => setOpen(true)}>
            {pending ? "Cancel request" : "Cancel booking"}
          </Button>
        )}
      </div>
      {b.canCancel && b.cancelDeadline && (
        <p className="mt-3 text-sm text-muted-foreground">You can cancel online until {formatDay(b.cancelDeadline, tz)}, {formatTime(b.cancelDeadline, tz)}.</p>
      )}

      <Dialog open={open} onOpenChange={(o) => !cancelling && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{pending ? "Cancel this request?" : "Cancel this booking?"}</DialogTitle>
            <DialogDescription>The slot will be released for others. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={reasonId}>
              Reason{" "}
              {!b.cancellationReasonRequired && <span className="font-normal text-muted-foreground">(optional)</span>}
            </Label>
            <Textarea
              id={reasonId}
              value={reason}
              maxLength={500}
              rows={3}
              onChange={(e) => setReason(e.target.value)}
              disabled={cancelling}
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonError ? reasonErrorId : undefined}
              aria-required={b.cancellationReasonRequired || undefined}
            />
            {reasonError && (
              <p id={reasonErrorId} role="alert" className="text-sm text-[#c4271d]">
                {reasonError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-full" disabled={cancelling} onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button type="button" variant="destructive" className="rounded-full" disabled={cancelling} onClick={() => void cancel()}>
              {cancelling ? "Cancelling…" : pending ? "Cancel request" : "Cancel booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
