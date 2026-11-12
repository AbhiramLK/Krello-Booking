import { cookies } from "next/headers";
import { effectiveStatus, listBookingsForTenant } from "@krello/core";
import { STATUS_LABEL } from "@krello/booking-engine/labels";
import { addDays, isValidDate, localToInstant } from "@krello/booking-engine/time";
import { BookingRow } from "@/components/dashboard/booking-row";
import { Pagination } from "@/components/marketplace/pagination";
import { PAYMENT_LABEL } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BOOKING_SEARCH_COOKIE, parseBoundSearch } from "@/lib/booking-search-cookie";
import { getDb } from "@/lib/db";
import { requireTenant } from "@/lib/session";
import { clearBookingFiltersAction, filterBookingsAction } from "../actions";
import { bookingFiltersSchema, bookingsHref, firstParam } from "../schemas";
import { getLocations } from "../tenant";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bookings" };

const PAGE_SIZE = 25;

const SOURCE_LABEL = { online: "Online request", phone: "Phone", walk_in: "Walk-in", admin: "Added by venue" } as const;

const selectClass =
  "h-10 w-full rounded-xl border border-input bg-card px-3 text-[15px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/** Every booking the member may see, filtered and paged. Filters live in the address so a view can be reloaded. */
export default async function BookingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireTenant("bookings.view");
  const raw = await searchParams;
  // The search text comes only from the cookie; a `q` in the address is ignored.
  const fromUrl = Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "q").map(([k, v]) => [k, firstParam(v)]));
  const f = bookingFiltersSchema.parse({ ...fromUrl, q: parseBoundSearch((await cookies()).get(BOOKING_SEARCH_COOKIE)?.value, ctx.user.id, ctx.business.id) });
  const locations = await getLocations(ctx);
  const tz = (locations.find((l) => l.id === f.location) ?? locations[0])?.timezone ?? "Asia/Kolkata";
  const from = f.from && isValidDate(f.from) ? localToInstant(f.from, 0, tz) : undefined;
  const to = f.to && isValidDate(f.to) ? localToInstant(addDays(f.to, 1), 0, tz) : undefined;

  const list = await listBookingsForTenant(getDb(), ctx, {
    statuses: f.status ? [f.status] : undefined,
    source: f.source,
    paymentStatus: f.payment,
    locationId: f.location,
    from,
    to,
    q: f.q,
    order: from ? "starts_asc" : "starts_desc",
    page: f.page,
    pageSize: PAGE_SIZE,
  });
  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const filtered = Boolean(f.q || f.status || f.source || f.payment || f.location || f.from || f.to);
  const now = new Date();

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Bookings</h1>
      <p className="mt-1 text-muted-foreground">Every request and booking, newest slot first unless you choose dates.</p>

      <form action={filterBookingsAction} role="search" aria-label="Filter bookings" className="mt-6 rounded-card border bg-card p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <Field id="f-q" label="Search">
              <Input id="f-q" name="q" type="search" defaultValue={f.q} placeholder="Name, phone or reference" className="h-10 rounded-xl bg-card" maxLength={100} />
            </Field>
          </div>
          <Field id="f-status" label="Status">
            <select id="f-status" name="status" defaultValue={f.status ?? ""} className={selectClass}>
              <option value="">Any status</option>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="f-payment" label="Payment">
            <select id="f-payment" name="payment" defaultValue={f.payment ?? ""} className={selectClass}>
              <option value="">Any payment</option>
              {Object.entries(PAYMENT_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="f-source" label="Source">
            <select id="f-source" name="source" defaultValue={f.source ?? ""} className={selectClass}>
              <option value="">Any source</option>
              {Object.entries(SOURCE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {locations.length > 1 && (
            <Field id="f-location" label="Location">
              <select id="f-location" name="location" defaultValue={f.location ?? ""} className={selectClass}>
                <option value="">All locations</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field id="f-from" label="From">
            <Input id="f-from" name="from" type="date" defaultValue={f.from} className="h-10 rounded-xl bg-card" />
          </Field>
          <Field id="f-to" label="To">
            <Input id="f-to" name="to" type="date" defaultValue={f.to} className="h-10 rounded-xl bg-card" />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="submit" className="h-10 rounded-full px-5">
            Apply filters
          </Button>
          {filtered && (
            <Button type="submit" variant="link" formAction={clearBookingFiltersAction} className="h-10 px-1 text-sm font-medium">
              Clear filters
            </Button>
          )}
        </div>
      </form>

      <p className="tabular mt-6 text-sm text-muted-foreground" aria-live="polite">
        {list.total === 0 ? "No bookings" : `${list.total} ${list.total === 1 ? "booking" : "bookings"}`}
        {filtered && " match these filters"}
      </p>

      {list.items.length === 0 ? (
        <p className="mt-3 rounded-card border bg-card p-6 text-[15px] text-muted-foreground">
          {filtered ? "Nothing matches. Try fewer filters or a wider date range." : "No bookings yet. Online requests and bookings you add appear here."}
        </p>
      ) : (
        <ul aria-label="Bookings" className="mt-3 flex flex-col gap-3">
          {list.items.map((b) => (
            <BookingRow key={b.id} booking={b} status={effectiveStatus(b, now)} showLocation={locations.length > 1} />
          ))}
        </ul>
      )}

      <Pagination page={Math.min(f.page, pages)} pages={pages} hrefFor={(p) => bookingsHref(f, p)} />
    </>
  );
}
