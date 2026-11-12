import { z } from "zod";
import { isValidDate } from "@krello/booking-engine/time";

// Calendar payloads come from the browser and are not trusted. z.object drops
// unknown keys, so a smuggled `now`, `businessId` or `actor` never reaches core.
// The business always comes from the session's membership, never from here.
// Ids are checked against the business and the member's locations in core.

const uuid = (message: string) => z.string({ message }).uuid(message);

/** An instant sent as ISO 8601 with an offset or Z, read as a Date. */
const instant = (message: string) =>
  z
    .string({ message })
    .datetime({ offset: true, message })
    .transform((s) => new Date(s));

const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .optional()
    .transform((s) => s || undefined);

const groupSize = z
  .number({ message: "Enter how many people." })
  .int("Enter how many people.")
  .min(1, "Enter how many people.")
  .max(500, "That is more people than one booking can hold.");

const selection = {
  locationId: uuid("Location not found."),
  resourceIds: z.array(uuid("Choose what to book."), { message: "Choose what to book." }).min(1, "Choose what to book.").max(20, "Too many items in one booking."),
  startsAt: instant("Choose a start time."),
  endsAt: instant("Choose an end time."),
  groupSize,
};

export const quoteManualBookingSchema = z.object(selection);

export const MANUAL_SOURCES = ["phone", "walk_in", "admin"] as const;

export const manualBookingSchema = z.object({
  ...selection,
  source: z.enum(MANUAL_SOURCES, { message: "Choose how the booking came in." }),
  // A blank name is allowed here: a walk-in becomes "Walk-in", and core refuses a blank one for the other sources.
  name: z.string({ message: "Enter the customer's name." }).trim().max(120, "Keep the name to 120 characters or fewer."),
  phone: optionalText(32, "That phone number is too long."),
  notes: optionalText(500, "Keep the notes to 500 characters or fewer."),
  idempotencyKey: uuid("Something went wrong. Close this window and try again."),
});

export const blockResourceSchema = z.object({
  resourceId: uuid("Choose what to block."),
  startsAt: instant("Choose when the block starts."),
  endsAt: instant("Choose when the block ends."),
  reason: optionalText(200, "Keep the reason to 200 characters or fewer."),
});

export const unblockSchema = z.object({ blockId: uuid("Block not found.") });

/* ---------- address bar ---------- */

/** A bad value in the address bar is ignored rather than failing the page. */
const loose = <T extends z.ZodTypeAny>(schema: T) => schema.optional().catch(undefined);

export const calendarParamsSchema = z.object({
  location: loose(z.string().uuid()),
  date: loose(z.string().refine(isValidDate)),
  view: z.enum(["day", "week"]).catch("day").default("day"),
});

export type CalendarParams = z.infer<typeof calendarParamsSchema>;

/** The availability endpoint's query: a location and a day. */
export const dayQuerySchema = z.object({
  locationId: z.string().uuid(),
  date: z.string().refine(isValidDate),
});
