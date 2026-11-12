import { afterEach, describe, expect, it, vi } from "vitest";
import { newKey } from "./new-key";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newKey", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns a UUID from crypto.randomUUID when it exists", () => {
    expect(newKey()).toMatch(UUID_V4);
  });

  it("still returns a version 4 UUID where crypto.randomUUID is missing (plain http)", () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const a = newKey();
    expect(a).toMatch(UUID_V4);
    expect(newKey()).not.toBe(a);
  });
});
