import { z } from "zod";

// Payloads come from the browser and are not trusted: they are parsed here, and
// only the parsed fields go on to core. z.object drops unknown keys, so a
// smuggled `userId` or `now` never gets through. The user always comes from the session.

export const bookingIdSchema = z.string({ message: "Booking not found." }).uuid("Booking not found.");

export const cancelAccountBookingSchema = z.object({
  bookingId: bookingIdSchema,
  reason: z
    .string()
    .trim()
    .max(500, "Keep the reason to 500 characters or fewer.")
    .optional()
    .transform((s) => s || undefined),
});

export const updateProfileSchema = z.object({
  name: z.string({ message: "Enter your name." }).max(500, "Keep your name to 80 characters or fewer."),
  email: z.string().max(500, "That email address is too long.").nullish(),
});
