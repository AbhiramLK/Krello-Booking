import { describe, expect, it } from "vitest";
import { bindSearch, parseBoundSearch } from "./booking-search-cookie";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const BUSINESS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_BUSINESS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("remembered bookings search", () => {
  it("returns the text for the user and business it was saved for", () => {
    expect(parseBoundSearch(bindSearch(USER, BUSINESS, "98765 43210"), USER, BUSINESS)).toBe("98765 43210");
  });

  it("keeps colons and dots inside the search text", () => {
    expect(parseBoundSearch(bindSearch(USER, BUSINESS, "a.b:c"), USER, BUSINESS)).toBe("a.b:c");
  });

  it("ignores a search saved by another user", () => {
    expect(parseBoundSearch(bindSearch(OTHER_USER, BUSINESS, "asha"), USER, BUSINESS)).toBeUndefined();
  });

  it("ignores a search saved in another business", () => {
    expect(parseBoundSearch(bindSearch(USER, OTHER_BUSINESS, "asha"), USER, BUSINESS)).toBeUndefined();
  });

  it("ignores an unbound or empty value", () => {
    expect(parseBoundSearch("asha", USER, BUSINESS)).toBeUndefined();
    expect(parseBoundSearch("", USER, BUSINESS)).toBeUndefined();
    expect(parseBoundSearch(undefined, USER, BUSINESS)).toBeUndefined();
    expect(parseBoundSearch(bindSearch(USER, BUSINESS, ""), USER, BUSINESS)).toBeUndefined();
  });
});
