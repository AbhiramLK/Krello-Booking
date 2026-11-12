import { describe, expect, it } from "vitest";
import { describeError } from "./log-error";

/** The shape drizzle-orm throws: the SQL and parameters are on the error and in its message. */
function queryFailure(cause: Error) {
  const e = new Error("Failed query: insert into customers (name, phone) values ($1, $2)\nparams: Asha Rao,+919876543210", { cause }) as Error & {
    query: string;
    params: unknown[];
  };
  e.query = "insert into customers (name, phone) values ($1, $2)";
  e.params = ["Asha Rao", "+919876543210"];
  return e;
}

describe("describeError", () => {
  it("keeps only name, message and code of an ordinary error", () => {
    const e = Object.assign(new RangeError("out of range"), { code: "E_RANGE", secret: "do not log" });
    expect(describeError(e)).toEqual({ name: "RangeError", message: "out of range", code: "E_RANGE" });
  });

  it("describes the driver error under a failed query, not the query parameters", () => {
    const cause = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505", detail: "Key (phone)=(+919876543210) exists" });
    const logged = describeError(queryFailure(cause));
    expect(logged).toEqual({ name: "Error", message: "duplicate key value violates unique constraint", code: "23505" });
    expect(JSON.stringify(logged)).not.toContain("Asha");
    expect(JSON.stringify(logged)).not.toContain("9876543210");
  });

  it("never prints the parameters of a failed query that has no cause", () => {
    const e = queryFailure(new Error("x"));
    e.cause = undefined;
    const logged = describeError(e);
    expect(JSON.stringify(logged)).not.toContain("Asha");
    expect(JSON.stringify(logged)).not.toContain("9876543210");
  });

  it("copes with a thrown value that is not an error", () => {
    expect(describeError("boom").message).toBe("A non-error value was thrown");
  });
});
