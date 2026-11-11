import { and, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import { bookingAllocations, resourceBlocks, resources, writeAudit, type Actor, type Db } from "@krello/database";
import { getTenantAccess } from "./context";
import { EngineError } from "./errors";

export type BlockRow = typeof resourceBlocks.$inferSelect;

/**
 * Blocks a resource for a period (maintenance, private event). Takes the same
 * resource lock as booking creation, so a block and a booking for the same
 * time cannot both succeed. A block is refused while live bookings overlap it:
 * the business must cancel those first, which notifies the customers.
 */
export async function createBlock(
  db: Db,
  input: {
    businessId: string;
    resourceId: string;
    startsAt: Date;
    endsAt: Date;
    reason?: string | null;
    actor: Actor;
  },
): Promise<BlockRow> {
  if (!(input.endsAt.getTime() > input.startsAt.getTime())) {
    throw new EngineError("validation", "The block must end after it starts.");
  }
  return db.transaction(async (tx) => {
    const access = await getTenantAccess(tx, input.businessId);
    if (!access.writable) throw new EngineError("read_only", "This account is read-only.");

    const [resource] = await tx
      .select()
      .from(resources)
      .where(and(eq(resources.id, input.resourceId), eq(resources.businessId, input.businessId)))
      .for("update");
    if (!resource) throw new EngineError("not_found", "Resource not found.");

    const clashes = await tx
      .select({ bookingId: bookingAllocations.bookingId })
      .from(bookingAllocations)
      .where(
        and(
          eq(bookingAllocations.resourceId, resource.id),
          inArray(bookingAllocations.status, ["held", "confirmed"]),
          lt(bookingAllocations.startsAt, input.endsAt),
          gt(bookingAllocations.endsAt, input.startsAt),
        ),
      );
    if (clashes.length) {
      const n = new Set(clashes.map((c) => c.bookingId)).size;
      throw new EngineError(
        "slot_conflict",
        `${n} booking${n === 1 ? "" : "s"} overlap this period. Decline or cancel ${n === 1 ? "it" : "them"} first.`,
        { bookingIds: [...new Set(clashes.map((c) => c.bookingId))] },
      );
    }

    const [block] = await tx
      .insert(resourceBlocks)
      .values({
        businessId: input.businessId,
        resourceId: resource.id,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        reason: input.reason?.trim() || null,
        createdBy: input.actor.userId ?? null,
      })
      .returning();
    await writeAudit(tx, {
      actor: input.actor,
      businessId: input.businessId,
      targetType: "resource_block",
      targetId: block!.id,
      action: "block.created",
      after: { resourceId: resource.id, startsAt: input.startsAt, endsAt: input.endsAt },
      reason: input.reason,
    });
    return block!;
  });
}

export async function removeBlock(
  db: Db,
  input: { businessId: string; blockId: string; actor: Actor; now?: Date },
): Promise<void> {
  await db.transaction(async (tx) => {
    const access = await getTenantAccess(tx, input.businessId);
    if (!access.writable) throw new EngineError("read_only", "This account is read-only.");
    const [block] = await tx
      .update(resourceBlocks)
      .set({ removedAt: input.now ?? new Date() })
      .where(
        and(
          eq(resourceBlocks.id, input.blockId),
          eq(resourceBlocks.businessId, input.businessId),
          isNull(resourceBlocks.removedAt),
        ),
      )
      .returning();
    if (!block) throw new EngineError("not_found", "Block not found.");
    await writeAudit(tx, {
      actor: input.actor,
      businessId: input.businessId,
      targetType: "resource_block",
      targetId: block.id,
      action: "block.removed",
    });
  });
}
