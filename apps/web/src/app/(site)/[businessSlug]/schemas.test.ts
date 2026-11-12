import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { submitRequestSchema } from "./schemas";

const valid = {
  locationId: randomUUID(),
  resourceIds: [randomUUID()],
  startsAt: "2026-11-14T12:30:00.000Z",
  endsAt: "2026-11-14T13:30:00.000Z",
  groupSize: 2,
  name: "  Asha  ",
  idempotencyKey: randomUUID(),
};

describe("submitRequestSchema", () => {
  it("parses dates on the server and drops fields the client must not set", () => {
    const parsed = submitRequestSchema.parse({ ...valid, now: "2020-01-01", phone: "+919999999999", source: "phone" });
    expect(parsed.startsAt).toBeInstanceOf(Date);
    expect(parsed.name).toBe("Asha");
    expect(parsed).not.toHaveProperty("now");
    expect(parsed).not.toHaveProperty("phone");
    expect(parsed).not.toHaveProperty("source");
  });

  it("treats a blank email as none and rejects a malformed one", () => {
    expect(submitRequestSchema.parse({ ...valid, email: "  " }).email).toBeUndefined();
    expect(submitRequestSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
  });

  it("rejects a missing name, a non-ISO time and a fractional group", () => {
    expect(submitRequestSchema.safeParse({ ...valid, name: " " }).success).toBe(false);
    expect(submitRequestSchema.safeParse({ ...valid, startsAt: "tomorrow" }).success).toBe(false);
    expect(submitRequestSchema.safeParse({ ...valid, groupSize: 1.5 }).success).toBe(false);
  });
});
