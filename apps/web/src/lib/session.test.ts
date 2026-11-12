import { beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a server bundle, and the cookie jar and database are replaced below.
vi.mock("server-only", () => ({}));

const jar = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => jar }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));
vi.mock("./db", () => ({ getDb: () => ({}) }));
vi.mock("@krello/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@krello/core")>()),
  createSession: async () => ({ token: "token", expiresAt: new Date("2030-01-01T00:00:00Z") }),
  revokeSession: async () => {},
}));

import { BOOKING_SEARCH_COOKIE, BOOKING_SEARCH_PATH } from "./booking-search-cookie";
import { endSession, startSession } from "./session";

const searchCookieDeleted = () =>
  jar.delete.mock.calls.some(([arg]) => arg?.name === BOOKING_SEARCH_COOKIE && arg?.path === BOOKING_SEARCH_PATH);

describe("remembered bookings search across sessions", () => {
  beforeEach(() => {
    jar.get.mockReset();
    jar.set.mockReset();
    jar.delete.mockReset();
  });

  it("is cleared when someone signs out", async () => {
    jar.get.mockReturnValue({ value: "session-token" });
    await endSession();
    expect(searchCookieDeleted()).toBe(true);
  });

  it("is cleared when someone signs out without a live session", async () => {
    jar.get.mockReturnValue(undefined);
    await endSession();
    expect(searchCookieDeleted()).toBe(true);
  });

  it("is cleared when a new session starts", async () => {
    await startSession("user-id");
    expect(searchCookieDeleted()).toBe(true);
  });
});
