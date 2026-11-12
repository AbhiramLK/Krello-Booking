import Link from "next/link";
import { getCollectionSummary, listCollections, listOutstandingBookings, PAYMENT_METHODS, type PaymentMethod } from "@krello/core";
import { LocationFilter } from "@/components/dashboard/location-filter";
import { Pagination } from "@/components/marketplace/pagination";
import { PaymentBadge, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getDb } from "@/lib/db";
import { formatDateShort, formatDay, formatDayLong, formatInr, formatRange, formatTime, timeZoneName } from "@/lib/format";
import { requireTenant } from "@/lib/session";
import { cn } from "@/lib/utils";
import { firstParam } from "../schemas";
import { getLocations } from "../tenant";
import { RANGE_KEYS, RANGE_LABEL, resolveRange } from "./range";
import { paymentsHref, paymentsQuerySchema } from "./schemas";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payments" };

const PAGE_SIZE = 25;
const METHOD_LABEL: Record<PaymentMethod, string> = { cash: "Cash", upi: "UPI", card: "Card", other: "Other" };

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <li className="rounded-card border bg-card p-4 sm:p-5">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="tabular mt-1 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
    </li>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-10" aria-label={title}>
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {note && <p className="mt-1 text-sm text-muted-foreground">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-card border bg-card p-5 text-[15px] text-muted-foreground">{children}</p>;

/**
 * What was booked, what was taken at the venue and what is still owed, for a
 * period. The three figures answer different questions and are never added or
 * relabelled: booking value is not money in hand.
 */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireTenant("payments.record");
  const raw = await searchParams;
  const q = paymentsQuerySchema.parse({
    range: firstParam(raw.range),
    from: firstParam(raw.from),
    to: firstParam(raw.to),
    location: firstParam(raw.location),
    page: firstParam(raw.page),
  });
  const locations = await getLocations(ctx);
  const locationId = locations.some((l) => l.id === q.location) ? q.location : undefined;
  const tz = (locations.find((l) => l.id === locationId) ?? locations[0])?.timezone ?? "Asia/Kolkata";
  const many = locations.length > 1 && !locationId;
  const now = new Date();
  const range = resolveRange({ range: q.range, from: q.from, to: q.to }, tz, now);
  const scope = { from: range.from, to: range.to, locationId };

  const db = getDb();
  const [summary, outstanding, ledger] = await Promise.all([
    getCollectionSummary(db, ctx, scope),
    listOutstandingBookings(db, ctx, scope),
    listCollections(db, ctx, { from: range.from, to: range.to, locationId, page: q.page, pageSize: PAGE_SIZE }),
  ]);
  const pages = Math.max(1, Math.ceil(ledger.total / PAGE_SIZE));
  const address = { range: range.key, from: range.fromDate, to: range.toDate, location: locationId };
  const period = range.fromDate === range.toDate ? formatDayLong(range.fromDate) : `${formatDateShort(range.fromDate)} to ${formatDateShort(range.toDate)}`;
  const confirmedCount = summary.paidCount + summary.partlyPaidCount + summary.unpaidCount;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Payments</h1>
          <p className="mt-1 text-muted-foreground">What was booked, what was taken at the venue, and what is still owed.</p>
        </div>
        <LocationFilter locations={locations} value={locationId} />
      </div>

      <nav aria-label="Period" className="-mx-4 mt-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex gap-2">
          {RANGE_KEYS.filter((k) => k !== "custom").map((key) => {
            const current = range.key === key;
            return (
              <li key={key} className="shrink-0">
                <Link
                  href={paymentsHref({ range: key, location: locationId })}
                  aria-current={current ? "true" : undefined}
                  className={cn(
                    "inline-flex h-10 items-center rounded-full px-4 text-sm font-medium outline-none ring-1 ring-border focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    current ? "bg-foreground text-background ring-foreground" : "bg-card hover:bg-muted",
                  )}
                >
                  {RANGE_LABEL[key]}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <form action="/dashboard/payments" method="get" aria-label="Custom period" className="mt-3 flex flex-wrap items-end gap-3">
        <input type="hidden" name="range" value="custom" />
        {locationId && <input type="hidden" name="location" value={locationId} />}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-from">From</Label>
          <Input id="p-from" name="from" type="date" required defaultValue={range.key === "custom" ? range.fromDate : undefined} className="h-10 rounded-xl bg-card" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-to">To</Label>
          <Input id="p-to" name="to" type="date" required defaultValue={range.key === "custom" ? range.toDate : undefined} className="h-10 rounded-xl bg-card" />
        </div>
        <Button type="submit" variant="outline" className="h-10 rounded-full px-5">
          Show custom period
        </Button>
      </form>

      {range.notice && (
        <p role="status" className="mt-3 rounded-2xl bg-card p-4 text-[15px]">
          {range.notice}
        </p>
      )}

      <p className="tabular mt-6 text-sm text-muted-foreground" aria-live="polite">
        {period} · {timeZoneName(range.from, tz)}
      </p>

      <ul aria-label="Payments in numbers" className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile label="Booking value" value={formatInr(summary.bookingValue)} hint={`Confirmed bookings starting in this period (${confirmedCount}). Not money in hand.`} />
        <Tile label="Collected" value={formatInr(summary.collected)} hint="Payments recorded in this period, less refunds." />
        <Tile label="Outstanding" value={formatInr(summary.outstanding)} hint="Still to collect on those confirmed bookings." />
      </ul>
      <p className="tabular mt-3 text-sm text-muted-foreground">
        {summary.paidCount} paid · {summary.partlyPaidCount} partly paid · {summary.unpaidCount} unpaid
        {summary.cancelledValue > 0 && ` · ${formatInr(summary.cancelledValue)} in cancelled bookings, not counted above`}
      </p>

      <Section title="Collected by method" note="Payments less refunds, by how they were taken.">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {PAYMENT_METHODS.map((m) => {
            const share = summary.collected > 0 ? Math.min(Math.max(summary.byMethod[m] / summary.collected, 0), 1) : 0;
            return (
              <div key={m} className="rounded-2xl border bg-card p-4">
                <dt className="text-sm font-medium text-muted-foreground">{METHOD_LABEL[m]}</dt>
                <dd className="tabular mt-1 text-xl font-semibold">{formatInr(summary.byMethod[m])}</dd>
                <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(share * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </dl>
      </Section>

      <Section
        title="Outstanding bookings"
        note={outstanding.total > outstanding.items.length ? `Showing the first ${outstanding.items.length} of ${outstanding.total}, soonest first.` : "Confirmed bookings in this period that are not paid in full, soonest first."}
      >
        {outstanding.items.length === 0 ? (
          <Empty>{confirmedCount === 0 ? "No confirmed bookings in this period." : "Every confirmed booking in this period is paid in full."}</Empty>
        ) : (
          <ul aria-label="Outstanding bookings" className="flex flex-col divide-y rounded-card border bg-card">
            {outstanding.items.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/dashboard/bookings/${b.id}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{b.customerName}</span>
                    <span className="tabular block text-sm text-muted-foreground">
                      {formatRange(b.startsAt, b.endsAt, b.timezone)}
                      {many && ` · ${b.locationName}`}
                    </span>
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      <StatusBadge status={b.status} />
                      <PaymentBadge status={b.paymentStatus} />
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="tabular block font-semibold">{formatInr(b.due)} due</span>
                    <span className="tabular block text-sm text-muted-foreground">
                      {formatInr(b.amountCollected)} of {formatInr(b.totalAmount)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Ledger" note="Every payment and refund recorded in this period, newest first.">
        {ledger.items.length === 0 ? (
          <Empty>
            {ledger.total === 0 ? "Nothing was recorded in this period." : "No entries on this page."} Payments recorded on a booking appear here.
          </Empty>
        ) : (
          <>
            <p className="tabular mb-2 text-sm text-muted-foreground" aria-live="polite">
              {ledger.total} {ledger.total === 1 ? "entry" : "entries"}
            </p>
            <div role="region" aria-label="Ledger table" tabIndex={0} className="overflow-x-auto rounded-card border bg-card outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <table className="w-full min-w-[640px] border-collapse text-left text-[15px]">
                <thead>
                  <tr className="border-b text-sm text-muted-foreground">
                    <th scope="col" className="px-4 py-3 font-medium">
                      When
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Booking
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Type
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Method
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Amount
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Recorded by
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {ledger.items.map((p) => (
                    <tr key={p.id} className="align-top">
                      <td className="tabular px-4 py-3">
                        {formatDay(p.collectedAt, p.timezone)}
                        <span className="block text-sm text-muted-foreground">{formatTime(p.collectedAt, p.timezone)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/bookings/${p.bookingId}`} className="font-medium text-primary hover:underline">
                          {p.customerName}
                        </Link>
                        <span className="tabular block text-sm text-muted-foreground">
                          {p.reference}
                          {many && ` · ${p.locationName}`}
                        </span>
                      </td>
                      <td className="px-4 py-3">{p.kind === "refund" ? "Refund" : "Payment"}</td>
                      <td className="px-4 py-3">
                        {METHOD_LABEL[p.method]}
                        {p.paymentReference && <span className="tabular block text-sm text-muted-foreground">{p.paymentReference}</span>}
                      </td>
                      <td className="tabular px-4 py-3 text-right font-semibold">
                        {p.kind === "refund" ? "−" : ""}
                        {formatInr(p.amount)}
                      </td>
                      <td className="px-4 py-3">{p.recordedByName ?? <span className="text-muted-foreground">Unknown</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <Pagination page={Math.min(q.page, pages)} pages={pages} hrefFor={(p) => paymentsHref(address, p)} />
      </Section>
    </>
  );
}
