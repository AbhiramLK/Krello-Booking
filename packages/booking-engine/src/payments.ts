import { and, eq } from "drizzle-orm";
import { bookings, payments, pgErrorCode, writeAudit, type Actor, type Db } from "@krello/database";
import { getTenantAccess } from "./context";
import { EngineError } from "./errors";
import type { BookingRow } from "./bookings";

export type PaymentRow = typeof payments.$inferSelect;

export interface RecordPaymentInput {
  businessId: string;
  bookingId: string;
  kind: "collection" | "refund";
  /** Paise, positive. */
  amount: number;
  method: "cash" | "upi" | "card" | "other";
  reference?: string | null;
  notes?: string | null;
  collectedAt?: Date;
  actor: Actor;
  idempotencyKey?: string | null;
}

const COLLECTABLE = new Set<BookingRow["status"]>(["approved", "completed", "no_show"]);

function statusFor(collected: number, total: number): BookingRow["paymentStatus"] {
  if (collected <= 0) return "unpaid";
  return collected >= total ? "paid" : "partially_paid";
}

/**
 * Records money taken (or handed back) at the venue. The ledger is
 * append-only: a mistake is corrected with a refund entry, not an edit. The
 * booking row is locked so that collections can never exceed the amount due.
 */
export async function recordPayment(
  db: Db,
  input: RecordPaymentInput,
): Promise<{ payment: PaymentRow; booking: BookingRow; replayed: boolean }> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new EngineError("validation", "Enter an amount greater than zero.");
  }
  try {
    return await db.transaction(async (tx) => {
      const access = await getTenantAccess(tx, input.businessId);
      if (!access.writable) throw new EngineError("read_only", "This account is read-only.");

      const [booking] = await tx
        .select()
        .from(bookings)
        .where(and(eq(bookings.id, input.bookingId), eq(bookings.businessId, input.businessId)))
        .for("update");
      if (!booking) throw new EngineError("not_found", "Booking not found.");

      if (input.idempotencyKey) {
        const [existing] = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.businessId, input.businessId), eq(payments.idempotencyKey, input.idempotencyKey)));
        if (existing) return { payment: existing, booking, replayed: true };
      }

      let collected = booking.amountCollected;
      if (input.kind === "collection") {
        if (!COLLECTABLE.has(booking.status)) {
          throw new EngineError("validation", "Payments can only be recorded against a confirmed booking.");
        }
        const due = booking.totalAmount - collected;
        if (input.amount > due) {
          throw new EngineError(
            "payment_exceeds_due",
            due === 0 ? "This booking is already fully paid." : `Only ₹${(due / 100).toLocaleString("en-IN")} is still due on this booking.`,
            { due },
          );
        }
        collected += input.amount;
      } else {
        if (input.amount > collected) {
          throw new EngineError("payment_exceeds_due", "A refund cannot be more than the amount collected.", { collected });
        }
        collected -= input.amount;
      }

      const [payment] = await tx
        .insert(payments)
        .values({
          bookingId: booking.id,
          businessId: input.businessId,
          kind: input.kind,
          amount: input.amount,
          method: input.method,
          reference: input.reference?.trim() || null,
          notes: input.notes?.trim() || null,
          collectedAt: input.collectedAt ?? new Date(),
          recordedBy: input.actor.userId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
        })
        .returning();
      const [updated] = await tx
        .update(bookings)
        .set({ amountCollected: collected, paymentStatus: statusFor(collected, booking.totalAmount), updatedAt: new Date() })
        .where(eq(bookings.id, booking.id))
        .returning();
      await writeAudit(tx, {
        actor: input.actor,
        businessId: input.businessId,
        targetType: "payment",
        targetId: payment!.id,
        action: input.kind === "collection" ? "payment.recorded" : "payment.refunded",
        after: { bookingId: booking.id, amount: input.amount, method: input.method, amountCollected: collected },
      });
      return { payment: payment!, booking: updated!, replayed: false };
    });
  } catch (e) {
    if (pgErrorCode(e) === "23505" && input.idempotencyKey) {
      const [existing] = await db
        .select()
        .from(payments)
        .where(and(eq(payments.businessId, input.businessId), eq(payments.idempotencyKey, input.idempotencyKey)));
      const [booking] = await db.select().from(bookings).where(eq(bookings.id, input.bookingId));
      if (existing && booking) return { payment: existing, booking, replayed: true };
    }
    throw e;
  }
}
