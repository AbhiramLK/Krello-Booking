import { describe, expect, it } from "vitest";
import { paymentsHref, paymentsQuerySchema, recordPaymentSchema } from "./schemas";

const ID = "5b1f0c1e-62a4-4c43-9f60-2a0d4f7a9c11";
const valid = { bookingId: ID, kind: "collection", amountRupees: "150", method: "upi", idempotencyKey: "key-12345678" };

describe("payment payload validation", () => {
  it("passes only the named fields, dropping a smuggled clock, business, actor or amounts", () => {
    const parsed = recordPaymentSchema.parse({
      ...valid,
      now: new Date(0),
      businessId: ID,
      actor: { kind: "system" },
      amount: 1,
      amountDue: 0,
      collectedAt: "2020-01-01T00:00:00Z",
    });
    expect(parsed).toEqual({ ...valid });
  });

  it("trims the rupee text and optional fields, and turns blanks into nothing", () => {
    const parsed = recordPaymentSchema.parse({ ...valid, amountRupees: " 150.50 ", reference: "  UPI-1 ", notes: "   " });
    expect(parsed.amountRupees).toBe("150.50");
    expect(parsed.reference).toBe("UPI-1");
    expect(parsed.notes).toBeUndefined();
  });

  it("accepts only a payment or a refund, and the four methods", () => {
    for (const kind of ["adjustment", "", 1, undefined]) expect(recordPaymentSchema.safeParse({ ...valid, kind }).success).toBe(false);
    for (const method of ["crypto", "", undefined]) expect(recordPaymentSchema.safeParse({ ...valid, method }).success).toBe(false);
    for (const method of ["cash", "upi", "card", "other"]) expect(recordPaymentSchema.safeParse({ ...valid, method }).success).toBe(true);
    expect(recordPaymentSchema.safeParse({ ...valid, kind: "refund" }).success).toBe(true);
  });

  it("takes the amount as text, not a number", () => {
    expect(recordPaymentSchema.safeParse({ ...valid, amountRupees: 150 }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ ...valid, amountRupees: undefined }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ ...valid, amountRupees: "1".repeat(21) }).success).toBe(false);
  });

  it("limits the booking id, text lengths and the idempotency key", () => {
    expect(recordPaymentSchema.safeParse({ ...valid, bookingId: "nope" }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ ...valid, reference: "x".repeat(101) }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ ...valid, notes: "x".repeat(501) }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ ...valid, idempotencyKey: "short" }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ ...valid, idempotencyKey: undefined }).success).toBe(false);
  });
});

describe("payments page address", () => {
  it("ignores bad values instead of failing", () => {
    expect(paymentsQuerySchema.parse({ range: "forever", from: "x", to: "2026-13-99x", location: "nope", page: "abc" })).toEqual({
      range: undefined,
      from: undefined,
      to: undefined,
      location: undefined,
      page: 1,
    });
    expect(paymentsQuerySchema.parse({ range: "7d", page: "3" })).toMatchObject({ range: "7d", page: 3 });
  });

  it("builds addresses that keep the range and location, and drop dates unless custom", () => {
    expect(paymentsHref({})).toBe("/dashboard/payments");
    expect(paymentsHref({ range: "today" })).toBe("/dashboard/payments");
    expect(paymentsHref({ range: "7d", from: "2026-11-01" })).toBe("/dashboard/payments?range=7d");
    expect(paymentsHref({ range: "custom", from: "2026-11-01", to: "2026-11-03", location: ID }, 2)).toBe(
      `/dashboard/payments?range=custom&from=2026-11-01&to=2026-11-03&location=${ID}&page=2`,
    );
  });
});
