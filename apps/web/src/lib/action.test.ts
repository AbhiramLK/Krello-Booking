import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside a server bundle; this test only exercises the wrapper.
vi.mock("server-only", () => ({}));

import { verifyOtpSchema } from "../app/login/schemas";
import { runAction } from "./action";

describe("runAction", () => {
  it("turns a bad sign-in payload into a validation result, not a crash", async () => {
    const result = await runAction(async () => verifyOtpSchema.parse({ phone: "+919000000091", code: 123456 }));
    expect(result).toMatchObject({ ok: false, code: "validation" });
    expect(result.ok === false && result.message).toBeTruthy();
  });

  it("passes a successful value through", async () => {
    expect(await runAction(async () => 42)).toEqual({ ok: true, data: 42 });
  });
});
