import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import {
  bookings,
  businessMemberships,
  businesses,
  locations,
  notifications,
  outboxEvents,
  pushSubscriptions,
  type Db,
  type DbOrTx,
} from "@krello/database";
import { can, type Role } from "./auth";

export interface PushMessage {
  title: string;
  body: string;
  link: string | null;
}

export interface PushTarget {
  id: string;
  endpoint: string;
  publicKey: string;
  authSecret: string;
}

/** Delivers one browser push. Throwing `gone: true` revokes the subscription. */
export interface PushSender {
  send(target: PushTarget, message: PushMessage): Promise<void>;
}

interface Recipient {
  userId?: string;
  /** Guests have no user row; they are reached through pushes tied to the booking. */
  guestBookingId?: string;
  title: string;
  body: string;
  link: string | null;
  businessId: string | null;
  push: boolean;
}

const timeFmt = (tz: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Turns one domain event into the messages it should produce (spec 13.2). */
async function resolveRecipients(db: DbOrTx, eventType: string, payload: Record<string, unknown>): Promise<Recipient[]> {
  if (!eventType.startsWith("booking.")) return [];
  const bookingId = String(payload.bookingId ?? "");
  const [row] = await db
    .select({ b: bookings, businessName: businesses.name, tz: locations.timezone })
    .from(bookings)
    .innerJoin(businesses, eq(businesses.id, bookings.businessId))
    .innerJoin(locations, eq(locations.id, bookings.locationId))
    .where(eq(bookings.id, bookingId));
  if (!row) return [];
  const { b, businessName, tz } = row;
  const when = timeFmt(tz).format(b.startsAt);
  const dashLink = `/dashboard/bookings/${b.id}`;
  // The customer link never carries the secret token; signed-in customers
  // open it from their bookings, guests already hold their status link.
  const customerLink = `/account/bookings/${b.id}`;

  const toBusiness = async (title: string, body: string, push: boolean): Promise<Recipient[]> => {
    const members = await db
      .select({ userId: businessMemberships.userId, role: businessMemberships.role, locationIds: businessMemberships.locationIds })
      .from(businessMemberships)
      .where(and(eq(businessMemberships.businessId, b.businessId), eq(businessMemberships.status, "active")));
    return members
      .filter((m) => can(m.role as Role, "bookings.view") && (m.role === "owner" || !m.locationIds.length || m.locationIds.includes(b.locationId)))
      .map((m) => ({ userId: m.userId, title, body, link: dashLink, businessId: b.businessId, push }));
  };
  const toCustomer = (title: string, body: string, push: boolean): Recipient[] => [
    b.customerUserId
      ? { userId: b.customerUserId, title, body, link: customerLink, businessId: null, push }
      : { guestBookingId: b.id, title, body, link: null, businessId: null, push },
  ];

  switch (eventType) {
    case "booking.requested":
      return toBusiness("New booking request", `${b.customerName} · ${when} · party of ${b.groupSize}`, true);
    case "booking.approved":
      return [
        ...toCustomer("Booking confirmed", `${businessName} confirmed your booking for ${when}.`, true),
        ...(await toBusiness("Booking approved", `${b.customerName} · ${when}`, false)),
      ];
    case "booking.rejected":
      return [
        ...toCustomer("Request declined", `${businessName} could not take your booking for ${when}.`, true),
        ...(await toBusiness("Request declined", `${b.customerName} · ${when}`, false)),
      ];
    case "booking.expired":
      return [
        ...toCustomer("Request expired", `${businessName} did not respond in time. The slot has been released.`, false),
        ...(await toBusiness("Request expired", `${b.customerName} · ${when} expired without a decision`, false)),
      ];
    case "booking.cancelled_by_customer":
      return toBusiness("Customer cancelled", `${b.customerName} cancelled ${when}. The slot is open again.`, true);
    case "booking.cancelled_by_business":
      return [
        ...toCustomer("Booking cancelled by venue", `${businessName} cancelled your booking for ${when}.`, true),
        ...(await toBusiness("Booking cancelled", `${b.customerName} · ${when}`, false)),
      ];
    default:
      return [];
  }
}

const MAX_ATTEMPTS = 6;

/**
 * Delivers queued events: writes in-app notifications and sends browser
 * pushes. Each event is claimed with SKIP LOCKED, so several workers can run
 * together. A failure is retried with a growing delay and never touches the
 * booking that caused it.
 */
export async function processOutbox(db: Db, opts: { push?: PushSender | null; limit?: number; now?: Date } = {}): Promise<{ processed: number; failed: number }> {
  const now = opts.now ?? new Date();
  let processed = 0;
  let failed = 0;

  for (let i = 0; i < (opts.limit ?? 100); i++) {
    const done = await db.transaction(async (tx) => {
      const [event] = await tx
        .select()
        .from(outboxEvents)
        .where(and(eq(outboxEvents.status, "pending"), lte(outboxEvents.availableAt, now)))
        .orderBy(asc(outboxEvents.createdAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!event) return "empty" as const;

      try {
        // A savepoint, so a failed delivery can be rolled back and recorded.
        await tx.transaction(async (sp) => {
          const recipients = await resolveRecipients(sp, event.eventType, event.payload);
          const inApp = recipients.filter((r) => r.userId);
          if (inApp.length) {
            await sp.insert(notifications).values(
              inApp.map((r) => ({
                recipientUserId: r.userId!,
                businessId: r.businessId,
                eventType: event.eventType,
                title: r.title,
                body: r.body,
                link: r.link,
              })),
            );
          }
          if (opts.push) {
            for (const r of recipients.filter((x) => x.push)) {
              const targets = await sp
                .select()
                .from(pushSubscriptions)
                .where(
                  and(
                    isNull(pushSubscriptions.revokedAt),
                    r.userId ? eq(pushSubscriptions.userId, r.userId) : eq(pushSubscriptions.bookingId, r.guestBookingId!),
                  ),
                );
              for (const t of targets) {
                try {
                  await opts.push.send(t, { title: r.title, body: r.body, link: r.link });
                } catch (e) {
                  // A dead subscription is revoked; other push errors are not
                  // worth failing the whole event over.
                  if ((e as { gone?: boolean }).gone) {
                    await sp.update(pushSubscriptions).set({ revokedAt: now }).where(eq(pushSubscriptions.id, t.id));
                  } else {
                    console.error("[push] delivery failed", e);
                  }
                }
              }
            }
          }
          await sp.update(outboxEvents).set({ status: "done", processedAt: now, attempts: event.attempts + 1 }).where(eq(outboxEvents.id, event.id));
        });
        return "ok" as const;
      } catch (e) {
        const attempts = event.attempts + 1;
        await tx
          .update(outboxEvents)
          .set({
            attempts,
            lastError: String(e).slice(0, 500),
            status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
            availableAt: new Date(now.getTime() + 2 ** attempts * 15_000),
          })
          .where(eq(outboxEvents.id, event.id));
        console.error(`[outbox] ${event.eventType} failed (attempt ${attempts})`, e);
        return "failed" as const;
      }
    });
    if (done === "empty") break;
    if (done === "ok") processed++;
    else failed++;
  }
  return { processed, failed };
}

export async function listNotifications(db: DbOrTx, userId: string, opts: { businessId?: string | null; limit?: number } = {}) {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientUserId, userId),
        opts.businessId === undefined ? undefined : opts.businessId === null ? isNull(notifications.businessId) : eq(notifications.businessId, opts.businessId),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(opts.limit ?? 30);
}

export async function countUnread(db: DbOrTx, userId: string, businessId?: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientUserId, userId),
        isNull(notifications.readAt),
        businessId ? eq(notifications.businessId, businessId) : undefined,
      ),
    );
  return row?.n ?? 0;
}

export async function markNotificationsRead(db: DbOrTx, userId: string, businessId?: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.recipientUserId, userId),
        isNull(notifications.readAt),
        businessId ? eq(notifications.businessId, businessId) : undefined,
      ),
    );
}

export async function savePushSubscription(
  db: DbOrTx,
  input: { userId?: string | null; bookingId?: string | null; endpoint: string; publicKey: string; authSecret: string; userAgent?: string | null },
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({
      userId: input.userId ?? null,
      bookingId: input.bookingId ?? null,
      endpoint: input.endpoint,
      publicKey: input.publicKey,
      authSecret: input.authSecret,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: input.userId ?? null, bookingId: input.bookingId ?? null, publicKey: input.publicKey, authSecret: input.authSecret, revokedAt: null },
    });
}
