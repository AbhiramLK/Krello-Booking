import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import {
  businessMemberships,
  businesses,
  otpChallenges,
  rateLimits,
  sessions,
  users,
  type Db,
  type DbOrTx,
} from "@krello/database";

export type UserRow = typeof users.$inferSelect;
export type MembershipRow = typeof businessMemberships.$inferSelect;

/** A failure that is safe to show to the person using the app. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/* ---------- phone numbers ---------- */

/** Normalises an Indian mobile number to +91XXXXXXXXXX, or returns null. */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/[^\d]/g, "");
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}

/** "+919812345678" → "98••••5678", for screens that should not show it all. */
export function maskPhone(phone: string): string {
  const local = phone.replace(/^\+91/, "");
  return `${local.slice(0, 2)}••••${local.slice(-4)}`;
}

/* ---------- rate limiting ---------- */

/**
 * Fixed-window counter kept in PostgreSQL (the spec avoids Redis for V1).
 * Returns false once `limit` hits have been made in the current window.
 */
export async function rateLimit(db: DbOrTx, key: string, limit: number, windowSeconds: number, now = new Date()): Promise<boolean> {
  const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({ target: [rateLimits.key, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + 1` } })
    .returning({ count: rateLimits.count });
  return (row?.count ?? 1) <= limit;
}

/* ---------- OTP ---------- */

export interface OtpSender {
  /** True when codes may be shown on screen (no real SMS is sent). */
  readonly demo: boolean;
  send(phone: string, code: string): Promise<void>;
}

/** Development adapter: prints the code to the server console. */
export const consoleOtpSender: OtpSender = {
  demo: true,
  async send(phone, code) {
    console.log(`[otp] ${phone} → ${code}`);
  },
};

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 30_000;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET must be set to at least 16 characters");
  return s;
}

const hashOtp = (phone: string, code: string) => createHmac("sha256", secret()).update(`${phone}:${code}`).digest("hex");
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export interface OtpRequestResult {
  /** Seconds until another code may be requested. */
  retryAfterSeconds: number;
  /** Only set by a demo sender, so a demo can run without SMS. */
  demoCode?: string;
}

/**
 * Sends a login code. The response is the same whether or not the number
 * already has an account, so it cannot be used to probe for customers.
 */
export async function requestOtp(
  db: Db,
  input: { phone: string; ip?: string | null; sender?: OtpSender; now?: Date },
): Promise<OtpRequestResult> {
  const phone = normalisePhone(input.phone);
  if (!phone) throw new AppError("invalid_phone", "Enter a valid 10-digit Indian mobile number.", 422);
  const now = input.now ?? new Date();
  const sender = input.sender ?? consoleOtpSender;

  const [last] = await db
    .select()
    .from(otpChallenges)
    .where(eq(otpChallenges.phone, phone))
    .orderBy(desc(otpChallenges.createdAt))
    .limit(1);
  if (last && now.getTime() - last.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((OTP_RESEND_COOLDOWN_MS - (now.getTime() - last.createdAt.getTime())) / 1000);
    throw new AppError("otp_cooldown", `Please wait ${wait} seconds before asking for another code.`, 429);
  }
  const okPhone = await rateLimit(db, `otp:phone:${phone}`, 5, 15 * 60, now);
  const okIp = input.ip ? await rateLimit(db, `otp:ip:${input.ip}`, 20, 15 * 60, now) : true;
  if (!okPhone || !okIp) throw new AppError("rate_limited", "Too many codes requested. Try again in a few minutes.", 429);

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(otpChallenges).values({
    phone,
    codeHash: hashOtp(phone, code),
    expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    createdAt: now,
  });
  await sender.send(phone, code);
  return { retryAfterSeconds: OTP_RESEND_COOLDOWN_MS / 1000, demoCode: sender.demo ? code : undefined };
}

/** Checks a code. On success returns the user for that phone, creating one if new. */
export async function verifyOtp(
  db: Db,
  input: { phone: string; code: string; name?: string | null; now?: Date },
): Promise<UserRow> {
  const phone = normalisePhone(input.phone);
  const code = input.code.replace(/\D/g, "");
  if (!phone || code.length !== 6) throw new AppError("invalid_code", "That code is not right. Check it and try again.", 422);
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [challenge] = await tx
      .select()
      .from(otpChallenges)
      .where(and(eq(otpChallenges.phone, phone), isNull(otpChallenges.consumedAt), gt(otpChallenges.expiresAt, now)))
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1)
      .for("update");
    if (!challenge) throw new AppError("otp_expired", "That code has expired. Ask for a new one.", 422);
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      throw new AppError("otp_locked", "Too many wrong attempts. Ask for a new code.", 429);
    }

    const expected = Buffer.from(challenge.codeHash, "hex");
    const given = Buffer.from(hashOtp(phone, code), "hex");
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      await tx.update(otpChallenges).set({ attempts: challenge.attempts + 1 }).where(eq(otpChallenges.id, challenge.id));
      // Returned, not thrown, so the attempt count is committed.
      return null;
    }
    await tx.update(otpChallenges).set({ consumedAt: now }).where(eq(otpChallenges.id, challenge.id));

    const name = input.name?.trim() || null;
    const [user] = await tx
      .insert(users)
      .values({ phone, phoneVerifiedAt: now, name, isSuperAdmin: phone === process.env.SUPER_ADMIN_PHONE })
      .onConflictDoUpdate({
        target: users.phone,
        set: { phoneVerifiedAt: now, updatedAt: now, name: sql`coalesce(${users.name}, ${name})` },
      })
      .returning();
    if (user!.status !== "active") throw new AppError("suspended", "This account has been suspended.", 403);
    return user!;
  }).then((user) => {
    if (!user) throw new AppError("invalid_code", "That code is not right. Check it and try again.", 422);
    return user;
  });
}

export async function cleanupExpiredOtps(db: Db, now = new Date()): Promise<void> {
  await db.delete(otpChallenges).where(lt(otpChallenges.expiresAt, new Date(now.getTime() - 60 * 60_000)));
  await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(now.getTime() - 24 * 60 * 60_000)));
}

/* ---------- sessions ---------- */

export const SESSION_COOKIE = "krello_session";
export const SESSION_TTL_DAYS = 30;

export async function createSession(db: DbOrTx, userId: string, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000);
  await db.insert(sessions).values({ userId, tokenHash: sha256(token), expiresAt });
  return { token, expiresAt };
}

export async function getSessionUser(db: DbOrTx, token: string | undefined | null, now = new Date()): Promise<UserRow | null> {
  if (!token) return null;
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)));
  if (!row || row.user.status !== "active") return null;
  return row.user;
}

export async function revokeSession(db: DbOrTx, token: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256(token)));
}

/** Ends every session of a user, e.g. when the account is suspended. */
export async function revokeAllSessions(db: DbOrTx, userId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/* ---------- roles and permissions ---------- */

export type Role = "owner" | "manager" | "staff";

/**
 * The one place that says what each business role may do (decisions.md OD-05).
 * UI and server code both ask `can()`; neither hardcodes role names.
 */
export const PERMISSIONS = {
  "dashboard.view": ["owner", "manager", "staff"],
  "bookings.view": ["owner", "manager", "staff"],
  "bookings.decide": ["owner", "manager"], // approve or reject online requests
  "bookings.create_manual": ["owner", "manager", "staff"],
  "bookings.cancel": ["owner", "manager"],
  "bookings.mark_attendance": ["owner", "manager", "staff"], // completed / no-show
  "bookings.add_note": ["owner", "manager", "staff"],
  "payments.record": ["owner", "manager", "staff"],
  "payments.refund": ["owner", "manager"],
  "customers.view": ["owner", "manager", "staff"],
  "resources.manage": ["owner", "manager"],
  "schedules.manage": ["owner", "manager"],
  "pricing.manage": ["owner", "manager"],
  "blocks.manage": ["owner", "manager"],
  "locations.manage": ["owner", "manager"],
  "profile.manage": ["owner", "manager"],
  "reviews.respond": ["owner", "manager"],
  "analytics.view": ["owner", "manager"],
  "settings.manage": ["owner"],
  "staff.manage": ["owner"],
  "subscription.manage": ["owner"],
  "audit.view": ["owner"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export interface TenantContext {
  user: UserRow;
  business: typeof businesses.$inferSelect;
  membership: MembershipRow;
  role: Role;
  can: (p: Permission) => boolean;
  /** Null means every location. */
  locationIds: string[] | null;
  canAccessLocation: (locationId: string) => boolean;
}

/**
 * Resolves what a signed-in user may do in a business. Access always comes
 * from the membership row, never from an id the browser sends.
 */
export async function getTenantContext(db: DbOrTx, user: UserRow, businessId: string): Promise<TenantContext | null> {
  const [row] = await db
    .select({ membership: businessMemberships, business: businesses })
    .from(businessMemberships)
    .innerJoin(businesses, eq(businesses.id, businessMemberships.businessId))
    .where(
      and(
        eq(businessMemberships.userId, user.id),
        eq(businessMemberships.businessId, businessId),
        eq(businessMemberships.status, "active"),
      ),
    );
  if (!row) return null;
  const role = row.membership.role;
  const locationIds = role === "owner" || !row.membership.locationIds.length ? null : row.membership.locationIds;
  return {
    user,
    business: row.business,
    membership: row.membership,
    role,
    can: (p) => can(role, p),
    locationIds,
    canAccessLocation: (id) => locationIds === null || locationIds.includes(id),
  };
}

export async function listMemberships(db: DbOrTx, userId: string) {
  return db
    .select({ membership: businessMemberships, business: businesses })
    .from(businessMemberships)
    .innerJoin(businesses, eq(businesses.id, businessMemberships.businessId))
    .where(and(eq(businessMemberships.userId, userId), eq(businessMemberships.status, "active")))
    .orderBy(businesses.name);
}
