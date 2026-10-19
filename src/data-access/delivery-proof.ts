import { db, type DbTransaction } from "@/db";
import { documents } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { PROOF_OF_DELIVERY_DOCUMENT_TYPES } from "@/lib/certification/delivery-evidence";
import { and, count, eq, inArray } from "drizzle-orm";
import { requireOrgScope } from "./utils";

/** One org-scoped query for all deliveries, including when reading in a transaction. */
export async function getDeliveryProofCounts(
  ctx: OrgContext,
  deliveryIds: readonly string[],
  executor: typeof db | DbTransaction = db,
): Promise<Map<string, number>> {
  requireOrgScope(ctx);
  if (deliveryIds.length === 0) return new Map();
  const rows = await executor.select({ deliveryId: documents.entityId, count: count() })
    .from(documents)
    .where(and(
      eq(documents.organizationId, ctx.organizationId),
      eq(documents.entityType, "delivery"),
      inArray(documents.entityId, [...new Set(deliveryIds)]),
      eq(documents.uploadStatus, "uploaded"),
      inArray(documents.documentType, [...PROOF_OF_DELIVERY_DOCUMENT_TYPES]),
    ))
    .groupBy(documents.entityId);
  return new Map(rows.map((row) => [row.deliveryId, row.count]));
}
