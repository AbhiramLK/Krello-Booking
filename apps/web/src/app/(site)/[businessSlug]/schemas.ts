import { z } from "zod";

// Booking payloads come from the browser and are not trusted. z.object drops
// unknown keys, so a smuggled `now`, `phone` or `source` never reaches core.

const instant = z
  .string({ message: "Choose a time." })
  .datetime({ offset: true, message: "Choose a time." })
  .transform((s) => new Date(s));

export const selectionSchema = z.object({
  locationId: z.string().uuid("Choose a location."),
  resourceIds: z.array(z.string().uuid()).min(1, "Choose at least one slot.").max(20, "Too many items in one request."),
  startsAt: instant,
  endsAt: instant,
  groupSize: z.number().int().min(1, "At least 1 person.").max(500, "Too many people for one request."),
});

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((s) => s || undefined);

export const submitRequestSchema = selectionSchema.extend({
  name: z.string({ message: "Enter your name." }).trim().min(1, "Enter your name.").max(80, "Keep your name to 80 characters or fewer."),
  email: optionalText(200, "That email address is too long.").pipe(z.string().email("Enter a valid email address.").optional()),
  notes: optionalText(500, "Keep notes to 500 characters or fewer."),
  idempotencyKey: z.string().uuid(),
});

export type SelectionInput = z.input<typeof selectionSchema>;
export type SubmitRequestInput = z.input<typeof submitRequestSchema>;
