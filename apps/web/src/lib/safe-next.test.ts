import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it.each(["/account", "/dashboard/bookings?status=pending", "/booking/abc#top", "/"])("keeps %s", (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "account",
    "",
    "/\t/evil.example",
    "/a\\b",
    "/login",
    "/login?next=/account",
  ])("rejects %j", (path) => {
    expect(safeNextPath(path)).toBeNull();
  });

  it("rejects a missing or repeated parameter", () => {
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(["/a", "/b"])).toBeNull();
  });
});
