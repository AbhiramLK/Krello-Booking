import { describe, expect, it } from "vitest";
import { addNoteSchema, bookingFiltersSchema, businessIdSchema, decideBookingSchema } from "./schemas";

const ID = "5b1f0c1e-62a4-4c43-9f60-2a0d4f7a9c11";

describe("dashboard payload validation", () => {
  it("passes only the booking id, action and reason, dropping a smuggled clock or business", () => {
    const parsed = decideBookingSchema.parse({ bookingId: ID, action: "approve", now: new Date(0), businessId: ID, actor: { kind: "system" } });
    expect(parsed).toEqual({ bookingId: ID, action: "approve" });
  });

  it("accepts only the five business decisions", () => {
    for (const action of ["approve", "reject", "cancel_by_business", "complete", "no_show"]) {
      expect(decideBookingSchema.safeParse({ bookingId: ID, action, reason: "Closed" }).success).toBe(true);
    }
    for (const action of ["expire", "cancel_by_customer", "delete", "", 1, undefined]) {
      expect(decideBookingSchema.safeParse({ bookingId: ID, action }).success).toBe(false);
    }
  });

  it("requires a reason to decline or cancel, and treats a blank one as missing", () => {
    expect(decideBookingSchema.safeParse({ bookingId: ID, action: "reject" }).success).toBe(false);
    const blank = decideBookingSchema.safeParse({ bookingId: ID, action: "cancel_by_business", reason: "   " });
    expect(blank.success).toBe(false);
    expect(blank.error?.issues[0]?.message).toBe("Give a reason for cancelling.");
    expect(decideBookingSchema.parse({ bookingId: ID, action: "reject", reason: "  Fully booked " }).reason).toBe("Fully booked");
    expect(decideBookingSchema.safeParse({ bookingId: ID, action: "reject", reason: "x".repeat(501) }).success).toBe(false);
  });

  it("rejects ids that are not UUIDs", () => {
    for (const bookingId of ["", "abc", `${ID}x`, 5, null]) {
      expect(decideBookingSchema.safeParse({ bookingId, action: "approve" }).success).toBe(false);
      expect(addNoteSchema.safeParse({ bookingId, note: "Hi" }).success).toBe(false);
    }
    expect(businessIdSchema.safeParse("not-a-business").success).toBe(false);
  });

  it("trims notes and refuses empty or very long ones", () => {
    expect(addNoteSchema.parse({ bookingId: ID, note: "  Regular, likes table 3 ", userId: "x" })).toEqual({ bookingId: ID, note: "Regular, likes table 3" });
    expect(addNoteSchema.safeParse({ bookingId: ID, note: "  " }).success).toBe(false);
    expect(addNoteSchema.safeParse({ bookingId: ID, note: "x".repeat(1001) }).success).toBe(false);
  });

  it("ignores bad list filters instead of failing the page", () => {
    expect(bookingFiltersSchema.parse({ status: "nonsense", location: "x", from: "yesterday", page: "-3", q: "  " })).toEqual({ page: 1 });
    expect(bookingFiltersSchema.parse({ status: "approved", source: "walk_in", payment: "paid", location: ID, from: "2026-11-01", to: "2026-11-30", q: " KR-ABC ", page: "2" })).toEqual({
      status: "approved",
      source: "walk_in",
      payment: "paid",
      location: ID,
      from: "2026-11-01",
      to: "2026-11-30",
      q: "KR-ABC",
      page: 2,
    });
  });
});
