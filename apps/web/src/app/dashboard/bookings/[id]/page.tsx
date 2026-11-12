import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Phone } from "lucide-react";
import { bookingActions, effectiveStatus, getBookingForTenant, type TenantBooking } from "@krello/core";
import { STATUS_LABEL } from "@krello/booking-engine/labels";
import { ExpiryCountdown } from "@/components/dashboard/expiry-countdown";
import { PaymentBadge, StatusBadge } from "@/components/status-badge";
import { getDb } from "@/lib/db";
import { formatDay, formatInr, formatRange, formatTime, timeZoneName } from "@/lib/format";
import { requireTenant } from "@/lib/session";
import { telHref } from "../../requests/request-card";
import { bookingIdSchema } from "../../schemas";
import { getWritable } from "../../tenant";
import { AddNoteForm, BookingActions } from "./booking-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Booking" };

const SOURCE_LABEL = { online: "Online request", phone: "Phone", walk_in: "Walk-in", admin: "Added by venue" } as const;
const METHOD_LABEL = { cash: "Cash", upi: "UPI", card: "Card", other: "Other" } as const;
const ACTOR_LABEL = { customer: "Customer", business: "Venue team", system: "Krello, automatically", admin: "Krello support" } as const;

type History = TenantBooking["history"][number];

function historyTitle(h: History): string {
  if (h.fromStatus === null) return h.toStatus === "pending" ? "Request sent" : "Booking added";
  return STATUS_LABEL[h.toStatus];
}

function historyActor(h: History): string {
  if (h.actorKind === "business" && h.actorName) return h.actorName;
  return ACTOR_LABEL[h.actorKind as keyof typeof ACTOR_LABEL] ?? "Unknown";
}

interface Note {
  at: Date | null;
  author: string | null;
  text: string;
}

/** Internal notes are stored as `[ISO-time Author] text` lines; a line without that prefix continues the previous note. */
function parseNotes(raw: string | null): Note[] {
  if (!raw) return [];
  const notes: Note[] = [];
  for (const line of raw.split("\n")) {
    const m = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)(?: ([^\]]*))?\] ?(.*)$/.exec(line);
    if (m) notes.push({ at: new Date(m[1]!), author: m[2] ?? null, text: m[3] ?? "" });
    else if (notes.length) notes[notes.length - 1]!.text += `\n${line}`;
    else notes.push({ at: null, author: null, text: line });
  }
  return notes;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 py-3 text-[15px] sm:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="mt-6 rounded-card border bg-card p-4 sm:p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Everything about one booking for the venue's team: details, history, notes and payments. */
export default async function DashboardBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenant("bookings.view");
  const id = bookingIdSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const [found, writable] = await Promise.all([getBookingForTenant(getDb(), ctx, id.data), getWritable(ctx.business.id)]);
  // Not this business, or not one of the member's locations: indistinguishable from a booking that does not exist.
  if (!found) notFound();

  const { booking: b, timezone: tz } = found;
  const now = new Date();
  const status = effectiveStatus(b, now);
  const actions = bookingActions(ctx, b, now);
  const notes = parseNotes(b.internalNotes);
  const due = Math.max(b.totalAmount - b.amountCollected, 0);
  const confirmed = status === "approved" || status === "completed" || status === "no_show";

  return (
    <article aria-labelledby="booking-heading">
      <Link href="/dashboard/bookings" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
        <ChevronLeft className="size-4" aria-hidden="true" />
        Bookings
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tabular text-sm font-medium text-muted-foreground">Booking {b.publicReference}</p>
          <h1 id="booking-heading" className="mt-1 break-words text-3xl font-semibold tracking-tight">
            {b.customerName}
          </h1>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge status={status} />
          {confirmed && <PaymentBadge status={b.paymentStatus} />}
        </div>
      </div>

      {status === "pending" && b.pendingExpiresAt && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-card p-4 text-[15px]">
          <ExpiryCountdown expiresAt={b.pendingExpiresAt.toISOString()} />
          <span>
            Answer by <span className="tabular">{formatTime(b.pendingExpiresAt, tz)}</span>, or the request expires and the slot is released.
          </span>
        </div>
      )}
      {b.status === "pending" && status === "expired" && (
        <p className="mt-4 rounded-2xl bg-card p-4 text-[15px]">The deadline passed before a decision, so this request can no longer be approved.</p>
      )}
      {b.rejectionReason && status === "rejected" && (
        <p className="mt-4 rounded-2xl bg-card p-4 text-[15px]">
          <span className="font-medium">Reason for declining:</span> {b.rejectionReason}
        </p>
      )}
      {b.cancellationReason && (status === "cancelled_by_business" || status === "cancelled_by_customer") && (
        <p className="mt-4 rounded-2xl bg-card p-4 text-[15px]">
          <span className="font-medium">Reason for cancelling:</span> {b.cancellationReason}
        </p>
      )}

      {actions.length > 0 && <BookingActions bookingId={b.id} actions={actions} disabled={!writable} customerName={b.customerName} className="mt-5" />}
      {status === "approved" && b.startsAt.getTime() > now.getTime() && ctx.can("bookings.mark_attendance") && (
        <p className="mt-3 text-sm text-muted-foreground">Mark completed and No-show appear once the booking has started.</p>
      )}

      <dl className="mt-6 divide-y rounded-card border bg-card px-4 sm:px-5">
        <Row label="When">
          <span className="tabular">{formatRange(b.startsAt, b.endsAt, tz)}</span>
          <span className="block text-sm text-muted-foreground">{timeZoneName(b.startsAt, tz)}</span>
        </Row>
        <Row label="Location">{found.locationName}</Row>
        <Row label="Booked">
          <ul>
            {found.allocations.map((a) => (
              <li key={a.resourceId}>
                {a.resourceName}
                {a.units > 1 && <span className="tabular text-muted-foreground"> × {a.units} places</span>}
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
        {b.customerEmail && <Row label="Email">{b.customerEmail}</Row>}
        <Row label="Source">{SOURCE_LABEL[b.source]}</Row>
        <Row label="Requested">
          <span className="tabular">
            {formatDay(b.requestedAt, tz)}, {formatTime(b.requestedAt, tz)}
          </span>
        </Row>
        <Row label="Customer notes">
          {b.customerNotes ? <span className="whitespace-pre-line">{b.customerNotes}</span> : <span className="text-muted-foreground">None</span>}
        </Row>
        <Row label="Total">
          <span className="tabular font-semibold">{formatInr(b.totalAmount)}</span>
        </Row>
      </dl>

      <Panel title="Payments">
        <dl className="mt-3 grid grid-cols-3 gap-3 text-[15px]">
          <div>
            <dt className="text-sm text-muted-foreground">Total</dt>
            <dd className="tabular font-semibold">{formatInr(b.totalAmount)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Collected</dt>
            <dd className="tabular font-semibold">{formatInr(b.amountCollected)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Still due</dt>
            <dd className="tabular font-semibold">{confirmed ? formatInr(due) : "–"}</dd>
          </div>
        </dl>
        {found.payments.length === 0 ? (
          <p className="mt-4 text-[15px] text-muted-foreground">No payments recorded yet. Customers pay at the venue.</p>
        ) : (
          <ul aria-label="Payment ledger" className="mt-4 divide-y border-t">
            {found.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-[15px]">
                <span className="min-w-0">
                  <span className="font-medium">{p.kind === "refund" ? "Refund" : "Collected"}</span>
                  <span className="text-muted-foreground"> · {METHOD_LABEL[p.method]}</span>
                  {p.reference && <span className="text-muted-foreground"> · {p.reference}</span>}
                  <span className="tabular block text-sm text-muted-foreground">
                    {formatDay(p.collectedAt, tz)}, {formatTime(p.collectedAt, tz)}
                    {p.recordedByName && ` · ${p.recordedByName}`}
                  </span>
                  {p.notes && <span className="block text-sm text-muted-foreground">{p.notes}</span>}
                </span>
                <span className="tabular font-semibold">
                  {p.kind === "refund" ? "−" : ""}
                  {formatInr(p.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="History">
        <ol className="mt-3 flex flex-col gap-4 border-l-2 border-border pl-4">
          {found.history.map((h, i) => (
            <li key={i} className="relative text-[15px]">
              <span aria-hidden="true" className="absolute -left-[1.4rem] top-1.5 size-2.5 rounded-full bg-muted-foreground/50 ring-4 ring-card" />
              <p className="font-medium">{historyTitle(h)}</p>
              <p className="tabular text-sm text-muted-foreground">
                {historyActor(h)} · {formatDay(h.createdAt, tz)}, {formatTime(h.createdAt, tz)}
              </p>
              {h.reason && <p className="mt-0.5 text-sm">“{h.reason}”</p>}
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="Internal notes">
        <p className="mt-1 text-sm text-muted-foreground">For your team only. Customers never see these.</p>
        {notes.length === 0 ? (
          <p className="mt-3 text-[15px] text-muted-foreground">No notes yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {notes.map((n, i) => (
              <li key={i} className="rounded-2xl bg-muted/60 p-3 text-[15px]">
                <p className="whitespace-pre-line break-words">{n.text}</p>
                {(n.at || n.author) && (
                  <p className="tabular mt-1 text-sm text-muted-foreground">
                    {[n.author, n.at && `${formatDay(n.at, tz)}, ${formatTime(n.at, tz)}`].filter(Boolean).join(" · ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {ctx.can("bookings.add_note") && <AddNoteForm bookingId={b.id} disabled={!writable} />}
      </Panel>
    </article>
  );
}
