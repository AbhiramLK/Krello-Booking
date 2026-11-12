import { z } from "zod";
import { bookingIdSchema } from "../schemas";
import { RANGE_KEYS, type RangeKey } from "./range";

// Payment payloads come from the browser and are not trusted. z.object drops
// unknown keys, so a smuggled `now`, `businessId`, actor, paise amount or
// computed amount-due never reaches core. The business comes from the
// session's membership, and the amount is parsed from rupees in core.

const AMOUNT_MESSAGE = "Enter an amount in rupees, like 150 or 150.50.";

const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .optional()
    .transform((s) => s || undefined);

export const recordPaymentSchema = z.object({
  bookingId: bookingIdSchema,
  kind: z.enum(["collection", "refund"], { message: "Choose whether this is a payment or a refund." }),
  amountRupees: z.string({ message: AMOUNT_MESSAGE }).trim().max(20, AMOUNT_MESSAGE),
  method: z.enum(["cash", "upi", "card", "other"], { message: "Choose how it was paid." }),
  reference: optionalText(100, "Keep the reference to 100 characters or fewer."),
  notes: optionalText(500, "Keep the note to 500 characters or fewer."),
  idempotencyKey: z
    .string({ message: "This form is out of date. Reload the page and try again." })
    .min(8, "This form is out of date. Reload the page and try again.")
    .max(100, "This form is out of date. Reload the page and try again."),
});

/* ---------- the page's address ---------- */

/** A bad value in the address bar is ignored rather than failing the page. */
const loose = <T extends z.ZodTypeAny>(schema: T) => schema.optional().catch(undefined);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const paymentsQuerySchema = z.object({
  range: loose(z.enum(RANGE_KEYS)),
  from: loose(date),
  to: loose(date),
  location: loose(z.string().uuid()),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});

export interface PaymentsQuery {
  range?: RangeKey;
  from?: string;
  to?: string;
  location?: string;
}

/** The payments page address for a range and location, optionally on a later ledger page. */
export function paymentsHref(q: PaymentsQuery, page = 1): string {
  const params = new URLSearchParams();
  if (q.range && q.range !== "today") params.set("range", q.range);
  if (q.range === "custom") {
    if (q.from) params.set("from", q.from);
    if (q.to) params.set("to", q.to);
  }
  if (q.location) params.set("location", q.location);
  if (page > 1) params.set("page", String(page));
  const s = params.toString();
  return s ? `/dashboard/payments?${s}` : "/dashboard/payments";
}
