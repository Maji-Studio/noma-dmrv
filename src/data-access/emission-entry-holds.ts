import { and, eq, inArray, isNull, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { emissionEntries } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope, type Executor } from "./utils";

/** Shared hold rule: an unsent replacement belongs to its scoped sent original. */
export function heldEmissionEntryPredicate(ctx: OrgContext, original: ReturnType<typeof alias<typeof emissionEntries, string>>) {
  requireOrgScope(ctx);
  return and(
    eq(original.organizationId, ctx.organizationId),
    eq(original.id, emissionEntries.replacesEntryId),
    isNotNull(original.sentByRemovalId),
    isNull(emissionEntries.sentByRemovalId),
  );
}

/** Tombstoned originals retain their sent owner until Removal deletion releases it. */
export async function loadEmissionEntryHolds(
  ctx: OrgContext,
  entries: readonly { id: string; replacesEntryId: string | null }[],
  executor: Executor = db,
): Promise<Map<string, string | null>> {
  requireOrgScope(ctx);
  const ids = entries.filter((entry) => entry.replacesEntryId).map((entry) => entry.id);
  if (!ids.length) return new Map();
  const original = alias(emissionEntries, "replaced_entry");
  const rows = await executor.select({ id: emissionEntries.id, removalId: original.sentByRemovalId })
    .from(emissionEntries)
    .innerJoin(original, heldEmissionEntryPredicate(ctx, original))
    .where(and(eq(emissionEntries.organizationId, ctx.organizationId), inArray(emissionEntries.id, ids)));
  return new Map(rows.map((row) => [row.id, row.removalId]));
}
