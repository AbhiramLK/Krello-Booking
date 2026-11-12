import { describe, expect, it } from "vitest";
import { blockResourceSchema, calendarParamsSchema, dayQuerySchema, manualBookingSchema, quoteManualBookingSchema, unblockSchema } from "./schemas";

const ID = "5b1f0c1e-62a4-4c43-9f60-2a0d4f7a9c11";
const KEY = "0a4c3b2e-8a62-4d7e-b9a4-3f1c2d5e6f70";

const booking = {
  locationId: ID,
  resourceIds: [ID],
  startsAt: "2030-01-01T10:00:00.000Z",
  endsAt: "2030-01-01T11:00:00.000Z",
  groupSize: 2,
  source: "walk_in",
  name: "  Ravi ",
  idempotencyKey: KEY,
};

describe("manual booking payload", () => {
  it("passes only the named fields, dropping a smuggled clock, business or actor", () => {
    const parsed = manualBookingSchema.parse({ ...booking, now: new Date(0), businessId: ID, actor: { kind: "system" }, createdBy: ID });
    expect(Object.keys(parsed).sort()).toEqual(["endsAt", "groupSize", "idempotencyKey", "locationId", "name", "resourceIds", "source", "startsAt"]);
    expect(parsed.name).toBe("Ravi");
    expect(parsed.startsAt).toEqual(new Date("2030-01-01T10:00:00.000Z"));
  });

  it("accepts only the three manual sources, never online", () => {
    for (const source of ["phone", "walk_in", "admin"]) expect(manualBookingSchema.safeParse({ ...booking, source }).success).toBe(true);
    for (const source of ["online", "", "Phone", undefined]) expect(manualBookingSchema.safeParse({ ...booking, source }).success).toBe(false);
  });

  it("treats blank phone and notes as not given, and allows a blank name for core to settle", () => {
    const parsed = manualBookingSchema.parse({ ...booking, name: "  ", phone: "  ", notes: "" });
    expect(parsed.name).toBe("");
    expect(parsed.phone).toBeUndefined();
    expect(parsed.notes).toBeUndefined();
  });

  it("rejects ids that are not UUIDs and instants without an offset", () => {
    for (const bad of [{ locationId: "x" }, { resourceIds: ["nope"] }, { resourceIds: [] }, { idempotencyKey: "abc" }, { startsAt: "2030-01-01T10:00:00" }, { endsAt: "tomorrow" }]) {
      expect(manualBookingSchema.safeParse({ ...booking, ...bad }).success).toBe(false);
    }
  });

  it("needs a whole number of people", () => {
    for (const groupSize of [0, 1.5, -1, 501, "2", null]) expect(manualBookingSchema.safeParse({ ...booking, groupSize }).success).toBe(false);
  });

  it("limits the length of free text", () => {
    expect(manualBookingSchema.safeParse({ ...booking, notes: "x".repeat(501) }).success).toBe(false);
    expect(manualBookingSchema.safeParse({ ...booking, name: "x".repeat(121) }).success).toBe(false);
  });
});

describe("quote payload", () => {
  it("takes the selection and nothing else", () => {
    const { source: _s, name: _n, idempotencyKey: _k, ...selection } = booking;
    const parsed = quoteManualBookingSchema.parse({ ...selection, now: new Date(0), audience: "customer" });
    expect(Object.keys(parsed).sort()).toEqual(["endsAt", "groupSize", "locationId", "resourceIds", "startsAt"]);
  });
});

describe("block payload", () => {
  const block = { resourceId: ID, startsAt: "2030-01-01T10:00:00+05:30", endsAt: "2030-01-01T12:00:00+05:30", reason: " Cloth change " };

  it("passes the resource, the period and a trimmed reason", () => {
    const parsed = blockResourceSchema.parse({ ...block, businessId: ID, now: new Date(0) });
    expect(Object.keys(parsed).sort()).toEqual(["endsAt", "reason", "resourceId", "startsAt"]);
    expect(parsed.reason).toBe("Cloth change");
    expect(parsed.startsAt.toISOString()).toBe("2030-01-01T04:30:00.000Z");
  });

  it("treats a blank reason as none and refuses a long one", () => {
    expect(blockResourceSchema.parse({ ...block, reason: "  " }).reason).toBeUndefined();
    expect(blockResourceSchema.safeParse({ ...block, reason: "x".repeat(201) }).success).toBe(false);
  });

  it("rejects a bad resource id, and a bad block id", () => {
    expect(blockResourceSchema.safeParse({ ...block, resourceId: "r1" }).success).toBe(false);
    expect(unblockSchema.safeParse({ blockId: "r1" }).success).toBe(false);
    expect(unblockSchema.parse({ blockId: ID, extra: 1 })).toEqual({ blockId: ID });
  });
});

describe("address bar", () => {
  it("ignores values it cannot read rather than failing the page", () => {
    expect(calendarParamsSchema.parse({ location: "x", date: "2030-02-30", view: "month" })).toEqual({ location: undefined, date: undefined, view: "day" });
    expect(calendarParamsSchema.parse({ location: ID, date: "2030-02-12", view: "week" })).toEqual({ location: ID, date: "2030-02-12", view: "week" });
  });

  it("needs a real location id and date for the refresh endpoint", () => {
    expect(dayQuerySchema.safeParse({ locationId: ID, date: "2030-02-12" }).success).toBe(true);
    expect(dayQuerySchema.safeParse({ locationId: ID, date: "2030-13-12" }).success).toBe(false);
    expect(dayQuerySchema.safeParse({ locationId: "x", date: "2030-02-12" }).success).toBe(false);
    expect(dayQuerySchema.safeParse({ date: "2030-02-12" }).success).toBe(false);
  });
});
