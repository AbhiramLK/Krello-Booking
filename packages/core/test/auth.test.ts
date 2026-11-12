import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@krello/database";
import { testDb } from "../../booking-engine/test/fixtures";
import {
  AppError,
  can,
  createSession,
  getSessionUser,
  normalisePhone,
  requestOtp,
  revokeSession,
  verifyOtp,
  type OtpSender,
} from "../src";

const db = testDb();

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
});

/** A sender that records the code instead of printing it. */
function capture() {
  const sent: { phone: string; code: string }[] = [];
  const sender: OtpSender = {
    demo: false,
    async send(phone, code) {
      sent.push({ phone, code });
    },
  };
  return { sent, sender, last: () => sent[sent.length - 1]!.code };
}

async function codeOf(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return undefined;
}

const wrongCodeFor = (right: string) => (right === "000000" ? "111111" : "000000");

// All times sit inside one 15-minute rate-limit window starting on a quarter hour.
const T0 = new Date("2026-03-02T10:00:00.000Z");
const after = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

describe("normalisePhone", () => {
  it.each(["98765 43210", "09876543210", "+91-9876543210", "919876543210"])("accepts %s", (input) => {
    expect(normalisePhone(input)).toBe("+919876543210");
  });

  it("accepts the leading-0 form of 80 and 79 mobile series", () => {
    expect(normalisePhone("08012345678")).toBe("+918012345678");
    expect(normalisePhone("07912345678")).toBe("+917912345678");
  });

  it.each(["987654321", "0801234567", "5876543210", "abc"])("rejects %s", (input) => {
    expect(normalisePhone(input)).toBeNull();
  });
});

describe("one-time codes", () => {
  it("verifies a code once and marks the phone verified", async () => {
    const { sender, last } = capture();
    const phone = "+919100000001";
    await requestOtp(db, { phone, sender, now: T0 });

    const user = await verifyOtp(db, { phone, code: last(), now: after(10) });
    expect(user.phone).toBe(phone);
    expect(user.phoneVerifiedAt).toBeInstanceOf(Date);

    // The code is single-use.
    expect(await codeOf(() => verifyOtp(db, { phone, code: last(), now: after(20) }))).toBe("otp_expired");
  });

  it("accepts the phone in any common format", async () => {
    const { sender, last } = capture();
    await requestOtp(db, { phone: "91000 00002", sender, now: T0 });
    const user = await verifyOtp(db, { phone: "+91-9100000002", code: last(), now: after(5) });
    expect(user.phone).toBe("+919100000002");
  });

  it("saves the name given when the account is created, and keeps an existing one", async () => {
    const { sender, last } = capture();
    const phone = "+919100000003";
    await requestOtp(db, { phone, sender, now: T0 });
    const created = await verifyOtp(db, { phone, code: last(), name: "  Asha  ", now: after(5) });
    expect(created.name).toBe("Asha");

    await requestOtp(db, { phone, sender, now: after(60) });
    const again = await verifyOtp(db, { phone, code: last(), name: "Someone Else", now: after(65) });
    expect(again.id).toBe(created.id);
    expect(again.name).toBe("Asha");
  });

  it("locks the code after five wrong attempts, even for the right code", async () => {
    const { sender, last } = capture();
    const phone = "+919100000004";
    await requestOtp(db, { phone, sender, now: T0 });
    const right = last();
    const wrong = wrongCodeFor(right);

    for (let i = 0; i < 5; i++) {
      expect(await codeOf(() => verifyOtp(db, { phone, code: wrong, now: after(5 + i) }))).toBe("invalid_code");
    }
    expect(await codeOf(() => verifyOtp(db, { phone, code: right, now: after(15) }))).toBe("otp_locked");
  });

  it("asks for a new code to unlock after too many wrong attempts", async () => {
    const { sender, last } = capture();
    const phone = "+919100000005";
    await requestOtp(db, { phone, sender, now: T0 });
    const wrong = wrongCodeFor(last());
    for (let i = 0; i < 5; i++) await codeOf(() => verifyOtp(db, { phone, code: wrong, now: after(5) }));

    await requestOtp(db, { phone, sender, now: after(40) });
    const user = await verifyOtp(db, { phone, code: last(), now: after(45) });
    expect(user.phone).toBe(phone);
  });

  it("refuses a second request within 30 seconds", async () => {
    const { sender, sent } = capture();
    const phone = "+919100000006";
    await requestOtp(db, { phone, sender, now: T0 });
    expect(await codeOf(() => requestOtp(db, { phone, sender, now: after(29) }))).toBe("otp_cooldown");
    expect(sent).toHaveLength(1);
    await expect(requestOtp(db, { phone, sender, now: after(31) })).resolves.toMatchObject({ retryAfterSeconds: 30 });
  });

  it("limits a phone to five codes per 15 minutes", async () => {
    const { sender, sent } = capture();
    const phone = "+919100000007";
    // Six requests, 31 s apart, all inside the window that starts at T0.
    for (let i = 0; i < 5; i++) await requestOtp(db, { phone, sender, now: after(i * 31) });
    expect(await codeOf(() => requestOtp(db, { phone, sender, now: after(5 * 31) }))).toBe("rate_limited");
    expect(sent).toHaveLength(5);
  });

  it("limits a client address to twenty codes per 15 minutes", async () => {
    const { sender } = capture();
    const ip = "203.0.113.77";
    for (let i = 0; i < 20; i++) {
      await requestOtp(db, { phone: `+9191100000${String(i).padStart(2, "0")}`, ip, sender, now: after(i) });
    }
    expect(
      await codeOf(() => requestOtp(db, { phone: "+919110000099", ip, sender, now: after(21) })),
    ).toBe("rate_limited");
  });

  it("expires a code after five minutes", async () => {
    const { sender, last } = capture();
    const phone = "+919100000008";
    await requestOtp(db, { phone, sender, now: T0 });
    expect(await codeOf(() => verifyOtp(db, { phone, code: last(), now: after(6 * 60) }))).toBe("otp_expired");
  });

  it("rejects a malformed phone or code before touching the database", async () => {
    expect(await codeOf(() => requestOtp(db, { phone: "12345", now: T0 }))).toBe("invalid_phone");
    expect(await codeOf(() => verifyOtp(db, { phone: "+919100000009", code: "12", now: T0 }))).toBe("invalid_code");
  });

  it("answers a new number and an existing user's number in the same shape", async () => {
    const { sender, last } = capture();
    const known = "+919100000010";
    await requestOtp(db, { phone: known, sender, now: T0 });
    await verifyOtp(db, { phone: known, code: last(), now: after(5) });

    const forKnown = await requestOtp(db, { phone: known, sender, now: after(60) });
    const forNew = await requestOtp(db, { phone: "+919100000011", sender, now: after(60) });
    expect(Object.keys(forKnown).sort()).toEqual(Object.keys(forNew).sort());
    expect(forKnown.retryAfterSeconds).toBe(forNew.retryAfterSeconds);
  });

  it("returns the code only for a demo sender", async () => {
    const demo = await requestOtp(db, {
      phone: "+919100000012",
      sender: { demo: true, async send() {} },
      now: T0,
    });
    expect(demo.demoCode).toMatch(/^\d{6}$/);

    const real = await requestOtp(db, { phone: "+919100000013", sender: capture().sender, now: T0 });
    expect(real.demoCode).toBeUndefined();
  });

  it("does not sign in a suspended account", async () => {
    const { sender, last } = capture();
    const phone = "+919100000014";
    await requestOtp(db, { phone, sender, now: T0 });
    const user = await verifyOtp(db, { phone, code: last(), now: after(5) });
    await db.update(users).set({ status: "suspended" }).where(eq(users.id, user.id));

    await requestOtp(db, { phone, sender, now: after(60) });
    expect(await codeOf(() => verifyOtp(db, { phone, code: last(), now: after(65) }))).toBe("suspended");
  });
});

describe("sessions", () => {
  async function makeUser(phone: string, status: "active" | "suspended" = "active") {
    const [user] = await db.insert(users).values({ phone, status, phoneVerifiedAt: new Date() }).returning();
    return user!;
  }

  it("finds the user for a live session and none after it is revoked", async () => {
    const user = await makeUser("+919100000020");
    const { token } = await createSession(db, user.id);

    expect((await getSessionUser(db, token))?.id).toBe(user.id);
    await revokeSession(db, token);
    expect(await getSessionUser(db, token)).toBeNull();
  });

  it("ignores a missing, unknown or expired token", async () => {
    const user = await makeUser("+919100000021");
    const { token } = await createSession(db, user.id, T0);

    expect(await getSessionUser(db, undefined)).toBeNull();
    expect(await getSessionUser(db, "not-a-real-token")).toBeNull();
    expect(await getSessionUser(db, token, new Date(T0.getTime() + 31 * 86_400_000))).toBeNull();
    expect((await getSessionUser(db, token, new Date(T0.getTime() + 29 * 86_400_000)))?.id).toBe(user.id);
  });

  it("returns null for a suspended user's session", async () => {
    const user = await makeUser("+919100000022", "suspended");
    const { token } = await createSession(db, user.id);
    expect(await getSessionUser(db, token)).toBeNull();
  });
});

describe("permissions", () => {
  it("lets managers decide bookings but not staff", () => {
    expect(can("staff", "bookings.decide")).toBe(false);
    expect(can("manager", "bookings.decide")).toBe(true);
  });

  it("keeps staff management and billing to owners", () => {
    expect(can("manager", "staff.manage")).toBe(false);
    expect(can("owner", "subscription.manage")).toBe(true);
  });
});
