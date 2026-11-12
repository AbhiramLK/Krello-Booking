import { describe, expect, it } from "vitest";
import { requestOtpSchema, verifyOtpSchema } from "./schemas";

describe("sign-in payload validation", () => {
  it("ignores extra fields such as a client-supplied clock", () => {
    const parsed = verifyOtpSchema.parse({ phone: "+919000000091", code: "123456", now: new Date(0), ip: "1.2.3.4" });
    expect(parsed).toEqual({ phone: "+919000000091", code: "123456" });
    expect("now" in parsed).toBe(false);

    expect(requestOtpSchema.parse({ phone: "9000000091", now: new Date(0) })).toEqual({ phone: "9000000091" });
  });

  it("rejects a code that is not a string", () => {
    for (const code of [123456, null, undefined, { replace: 1 }, ["123456"]]) {
      expect(verifyOtpSchema.safeParse({ phone: "+919000000091", code }).success).toBe(false);
    }
  });

  it("rejects a phone that is not a string or is absurdly long", () => {
    expect(verifyOtpSchema.safeParse({ phone: 9000000091, code: "123456" }).success).toBe(false);
    expect(requestOtpSchema.safeParse({ phone: "9".repeat(500) }).success).toBe(false);
    expect(requestOtpSchema.safeParse({}).success).toBe(false);
  });

  it("trims the name and caps it at 80 characters", () => {
    expect(verifyOtpSchema.parse({ phone: "+919000000091", code: "123456", name: "  Asha  " }).name).toBe("Asha");
    expect(verifyOtpSchema.safeParse({ phone: "+919000000091", code: "123456", name: "x".repeat(81) }).success).toBe(false);
    expect(verifyOtpSchema.safeParse({ phone: "+919000000091", code: "123456", name: 5 }).success).toBe(false);
  });
});
