import { z } from "zod";

// Dashboard payloads come from the browser and are not trusted. z.object drops
// unknown keys, so a smuggled `now`, `businessId` or `actor` never reaches core.
// The business always comes from the session's membership, never from here.

export const bookingIdSchema = z.string({ message: "Booking not found." }).uuid("Booking not found.");

/** Only the decisions a business may make. `expire` and customer cancellation are not among them. */
export const DECISION_ACTIONS = ["approve", "reject", "cancel_by_business", "complete", "no_show"] as const;

export const decideBookingSchema = z
  .object({
    bookingId: bookingIdSchema,
    action: z.enum(DECISION_ACTIONS, { message: "That is not something you can do to a booking." }),
    reason: z
      .string()
      .trim()
      .max(500, "Keep the reason to 500 characters or fewer.")
      .optional()
      .transform((s) => s || undefined),
  })
  .superRefine((v, ctx) => {
    if ((v.action === "reject" || v.action === "cancel_by_business") && !v.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: v.action === "reject" ? "Give a reason for declining." : "Give a reason for cancelling.",
      });
    }
  });

export const addNoteSchema = z.object({
  bookingId: bookingIdSchema,
  note: z
    .string({ message: "Write a note first." })
    .trim()
    .min(1, "Write a note first.")
    .max(1000, "Keep the note to 1000 characters or fewer."),
});

export const businessIdSchema = z.string({ message: "Business not found." }).uuid("Business not found.");

/* ---------- list filters, read from the URL ---------- */

const STATUSES = ["pending", "approved", "rejected", "expired", "cancelled_by_customer", "cancelled_by_business", "completed", "no_show"] as const;
const SOURCES = ["online", "phone", "walk_in", "admin"] as const;
const PAYMENT_STATUSES = ["unpaid", "partially_paid", "paid"] as const;

/** A bad value in the address bar is ignored rather than failing the page. */
const loose = <T extends z.ZodTypeAny>(schema: T) => schema.optional().catch(undefined);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const bookingFiltersSchema = z.object({
  status: loose(z.enum(STATUSES)),
  source: loose(z.enum(SOURCES)),
  payment: loose(z.enum(PAYMENT_STATUSES)),
  location: loose(z.string().uuid()),
  from: loose(date),
  to: loose(date),
  q: loose(z.string().trim().max(100).transform((s) => s || undefined)),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});

export type BookingFilters = z.infer<typeof bookingFiltersSchema>;

/** The bookings list address for a filter set. Never includes the search text. */
export function bookingsHref(f: Omit<BookingFilters, "q" | "page">, page = 1): string {
  const q = new URLSearchParams();
  for (const key of ["status", "source", "payment", "location", "from", "to"] as const) {
    const v = f[key];
    if (v) q.set(key, v);
  }
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `/dashboard/bookings?${s}` : "/dashboard/bookings";
}

export const locationParamSchema = loose(z.string().uuid());

/** First value of a search param that may repeat. */
export function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
