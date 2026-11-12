import { z } from "zod";

// Server action payloads come from the browser and are not trusted: they are
// parsed here, and only the parsed fields (never the raw object) go to core.
// z.object drops unknown keys, so a smuggled `now` or similar never gets through.

export const requestOtpSchema = z.object({
  phone: z.string({ message: "Enter your mobile number." }).max(32, "Enter a valid 10-digit Indian mobile number."),
});

export const verifyOtpSchema = z.object({
  phone: z.string({ message: "Enter your mobile number." }).max(32, "Enter a valid 10-digit Indian mobile number."),
  code: z.string({ message: "Enter the 6-digit code." }).max(32, "Enter the 6-digit code."),
  name: z.string().trim().max(80, "Keep your name to 80 characters or fewer.").optional(),
});
