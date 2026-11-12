import { eq } from "drizzle-orm";
import { users, type DbOrTx } from "@krello/database";
import { z } from "zod";
import { AppError, type UserRow } from "./auth";

const profileSchema = z.object({
  name: z
    .string({ message: "Enter your name." })
    .trim()
    .min(1, "Enter your name.")
    .max(80, "Keep your name to 80 characters or fewer."),
  // Blank or null clears the address.
  email: z
    .string()
    .nullish()
    .transform((e) => e?.trim() || null)
    .pipe(z.string().max(254, "That email address is too long.").email("Enter a valid email address, or leave it blank.").nullable()),
});

/**
 * Updates the signed-in customer's own name and email. The phone number is the
 * verified sign-in identity and is never changed here. Throws `AppError` with
 * code `validation` for a bad name or email.
 */
export async function updateProfile(db: DbOrTx, userId: string, input: { name: string; email?: string | null }): Promise<UserRow> {
  const parsed = profileSchema.safeParse({ name: input.name, email: input.email });
  if (!parsed.success) throw new AppError("validation", parsed.error.issues[0]?.message ?? "Check your details and try again.", 400);
  const [row] = await db
    .update(users)
    .set({ name: parsed.data.name, email: parsed.data.email, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  if (!row) throw new AppError("not_found", "Account not found.", 404);
  return row;
}
