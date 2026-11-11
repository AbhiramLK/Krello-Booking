import { auditLogs, outboxEvents } from "./schema";
import type { DbOrTx } from "./index";

export type ActorKind = "customer" | "business" | "system" | "admin";

export interface Actor {
  kind: ActorKind;
  userId?: string | null;
}

export const SYSTEM_ACTOR: Actor = { kind: "system", userId: null };

export interface AuditEntry {
  actor: Actor;
  businessId?: string | null;
  targetType: string;
  targetId?: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

/** Appends an audit row. Call inside the transaction that makes the change. */
export async function writeAudit(tx: DbOrTx, e: AuditEntry): Promise<void> {
  await tx.insert(auditLogs).values({
    actorUserId: e.actor.userId ?? null,
    actorKind: e.actor.kind,
    businessId: e.businessId ?? null,
    targetType: e.targetType,
    targetId: e.targetId ?? null,
    action: e.action,
    before: e.before ?? null,
    after: e.after ?? null,
    reason: e.reason ?? null,
    metadata: e.metadata ?? null,
  });
}

/**
 * Queues a domain event in the outbox. Written in the same transaction as the
 * change and delivered later by the worker, so a failed notification can never
 * undo a booking.
 */
export async function enqueueEvent(
  tx: DbOrTx,
  eventType: string,
  payload: Record<string, unknown>,
  businessId?: string | null,
): Promise<void> {
  await tx.insert(outboxEvents).values({ eventType, payload, businessId: businessId ?? null });
}
