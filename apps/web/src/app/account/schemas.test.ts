import { describe, expect, it } from "vitest";
import { bookingIdSchema, cancelAccountBookingSchema, updateProfileSchema } from "./schemas";

const ID = "5b1f0c1e-62a4-4c43-9f60-2a0d4f7a9c11";

describe("account payload validation", () => {
  it("passes only the booking id and reason, dropping a smuggled user or clock", () => {
    const parsed = cancelAccountBookingSchema.parse({ bookingId: ID, reason: "  Plans changed ", userId: "someone-else", now: new Date(0) });
    expect(parsed).toEqual({ bookingId: ID, reason: "Plans changed" });
    expect("userId" in parsed).toBe(false);
  });

  it("treats a blank reason as none", () => {
    expect(cancelAccountBookingSchema.parse({ bookingId: ID, reason: "   " }).reason).toBeUndefined();
  });

  it("rejects ids that are not UUIDs, and non-string ids", () => {
    for (const bookingId of ["", "abc", "../../etc", `${ID}x`, 5, null, undefined, { toString: () => ID }]) {
      expect(bookingIdSchema.safeParse(bookingId).success).toBe(false);
      expect(cancelAccountBookingSchema.safeParse({ bookingId }).success).toBe(false);
    }
    expect(bookingIdSchema.safeParse(ID).success).toBe(true);
  });

  it("rejects a reason over 500 characters", () => {
    expect(cancelAccountBookingSchema.safeParse({ bookingId: ID, reason: "x".repeat(501) }).success).toBe(false);
  });

  it("profile payload keeps only name and email and rejects non-strings", () => {
    expect(updateProfileSchema.parse({ name: "Asha", email: null, userId: "x", phone: "+910000000000" })).toEqual({ name: "Asha", email: null });
    expect(updateProfileSchema.safeParse({ name: 5 }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ name: "Asha", email: 5 }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ name: undefined }).success).toBe(false);
  });
});
