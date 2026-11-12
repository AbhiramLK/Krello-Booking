"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Ban, ExternalLink, Phone, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PaymentBadge, StatusBadge } from "@/components/status-badge";
import { formatInr, formatRange, minuteLabel } from "@/lib/format";
import { unblockResourceAction } from "./actions";
import { blocksInSlot, bookingsInSlot, placesTaken } from "./geometry";
import type { BlockView, BookingView, DayView } from "./view-model";
import { isConfirmed, slotBookingLine, SOURCE_WORD } from "./words";

export type QuickTarget =
  | { kind: "booking"; id: string }
  | { kind: "block"; id: string }
  /** A shared resource's slot: the bookings that hold its places. */
  | { kind: "slot"; resourceId: string; startMinute: number };

const telHref = (phone: string) => `tel:${phone.replace(/[^+\d]/g, "")}`;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 py-2.5 text-[15px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function BookingDetails({ b, tz }: { b: BookingView; tz: string }) {
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        <StatusBadge status={b.status} />
        {isConfirmed(b.status) && <PaymentBadge status={b.paymentStatus} />}
      </div>
      <dl className="mt-2 divide-y">
        <Row label="When">
          <span className="tabular">{formatRange(b.startsAt, b.endsAt, tz)}</span>
        </Row>
        <Row label="Booked">
          <ul>
            {b.items.map((i) => (
              <li key={i.resourceId}>
                {i.name}
                {i.units > 1 && <span className="tabular text-muted-foreground"> × {i.units} places</span>}
              </li>
            ))}
          </ul>
        </Row>
        <Row label="People">
          <span className="tabular">{b.groupSize}</span>
        </Row>
        <Row label="Phone">
          {b.customerPhone ? (
            <a href={telHref(b.customerPhone)} className="tabular inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
              <Phone className="size-3.5" aria-hidden="true" />
              {b.customerPhone}
            </a>
          ) : (
            <span className="text-muted-foreground">Not given</span>
          )}
        </Row>
        <Row label="Source">{SOURCE_WORD[b.source]}</Row>
        <Row label="Booking total">
          <span className="tabular font-semibold">{formatInr(b.totalAmount)}</span>
          {b.status === "pending" && <span className="block text-sm text-muted-foreground">Awaiting an answer. Not confirmed yet.</span>}
        </Row>
        <Row label="Reference">
          <span className="tabular">{b.reference}</span>
        </Row>
      </dl>
    </>
  );
}

/**
 * What is behind a block on the grid: one booking, one block, or the bookings
 * sharing a slot. Everything shown comes from the server's day; the only
 * action here is lifting a block, which the server checks again.
 */
export function QuickView({
  target,
  day,
  canCreate,
  canBlock,
  writable,
  onClose,
  onAdd,
  onChanged,
}: {
  target: QuickTarget | null;
  day: DayView;
  canCreate: boolean;
  canBlock: boolean;
  writable: boolean;
  onClose: () => void;
  onAdd: (resourceId: string, startMinute: number) => void;
  onChanged: () => void;
}) {
  const tz = day.timezone;
  const [removing, setRemoving] = useState(false);

  const booking = target?.kind === "booking" ? day.bookings.find((b) => b.id === target.id) : undefined;
  const block: BlockView | undefined = target?.kind === "block" ? day.blocks.find((b) => b.id === target.id) : undefined;
  const resource = target && target.kind !== "booking" && target.kind !== "block" ? day.resources.find((r) => r.id === target.resourceId) : undefined;
  const slot = target?.kind === "slot" ? resource?.slots.find((s) => s.startMinute === target.startMinute) : undefined;

  async function remove(b: BlockView) {
    setRemoving(true);
    try {
      const result = await unblockResourceAction({ blockId: b.id });
      if (!result.ok) {
        toast.error(result.message);
        onChanged();
        return;
      }
      toast.success("Block removed");
      onChanged();
      onClose();
    } catch {
      toast.error("We could not reach the server. Check your connection and try again.");
    } finally {
      setRemoving(false);
    }
  }

  let title = "Details";
  let description: string | undefined;
  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;

  if (booking) {
    title = booking.customerName;
    description = `Booking ${booking.reference}`;
    body = <BookingDetails b={booking} tz={tz} />;
    footer = (
      <Button asChild className="h-10 rounded-full px-5">
        <Link href={`/dashboard/bookings/${booking.id}`}>
          <ExternalLink aria-hidden="true" />
          Open booking
          <span className="sr-only"> for {booking.customerName}</span>
        </Link>
      </Button>
    );
  } else if (block) {
    const resourceName = day.resources.find((r) => r.id === block.resourceId)?.name ?? "Resource";
    title = `${resourceName} is blocked`;
    description = block.reason ?? "No reason given";
    body = (
      <p className="tabular text-[15px]">
        {formatRange(block.startsAt, block.endsAt, tz)}
      </p>
    );
    footer =
      canBlock ? (
        <Button
          type="button"
          variant="outline"
          className="h-10 rounded-full px-5"
          disabled={!writable || removing}
          title={writable ? undefined : "Read-only: renew the subscription to manage the calendar."}
          onClick={() => void remove(block)}
        >
          <Ban aria-hidden="true" />
          {removing ? "Removing…" : "Remove block"}
        </Button>
      ) : null;
  } else if (resource && slot) {
    const here = bookingsInSlot(day, resource.id, slot);
    const blocks = blocksInSlot(day, resource.id, slot);
    const taken = placesTaken(here, resource.id);
    title = `${resource.name}, ${minuteLabel(slot.startMinute)} – ${minuteLabel(slot.endMinute)}`;
    description = `${taken} of ${resource.capacity} places taken`;
    body = (
      <>
        {blocks.length > 0 && <p className="mb-2 text-[15px]">Blocked: {blocks.map((b) => b.reason ?? "no reason given").join("; ")}</p>}
        {here.length === 0 ? (
          <p className="text-[15px] text-muted-foreground">Nobody is booked into this slot yet.</p>
        ) : (
          <ul aria-label="Bookings in this slot" className="divide-y rounded-2xl border">
            {here.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{b.customerName}</span>
                  <span className="tabular block text-sm text-muted-foreground">
                    {slotBookingLine(b, resource.id, tz)}
                  </span>
                </span>
                <Link href={`/dashboard/bookings/${b.id}`} className="shrink-0 text-sm font-medium text-primary hover:underline">
                  Open<span className="sr-only"> booking for {b.customerName}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </>
    );
    footer =
      canCreate && slot.remaining > 0 && slot.state === "available" ? (
        <Button type="button" className="h-10 rounded-full px-5" disabled={!writable} onClick={() => onAdd(resource.id, slot.startMinute)}>
          <Plus aria-hidden="true" />
          Add booking
        </Button>
      ) : null;
  }

  const missing = target !== null && !booking && !block && !(resource && slot);
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{missing ? "No longer on the calendar" : title}</DialogTitle>
          <DialogDescription>{missing ? "It was changed or removed while you were looking." : description}</DialogDescription>
        </DialogHeader>
        {body}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
