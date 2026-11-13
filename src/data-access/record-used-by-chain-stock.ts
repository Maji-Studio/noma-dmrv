import { and, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { binMovements, outputStockAllocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { usedByEdge, usedByMass } from "@/lib/record-used-by-chain-graph";
import type { RecordUsedByEdge } from "@/lib/record-used-by-chain";
import { liveOutputDraw } from "./output-stock-active-movements";
import { requireOrgScope } from "./utils";

/** Live layer draws, aggregated before traversal so corrections cannot count twice. */
export async function readUsedByStockEdges(
  ctx: OrgContext, kind: "productionRun" | "biocharProduct" | "delivery", ids: string[],
): Promise<RecordUsedByEdge[]> {
  requireOrgScope(ctx);
  if (!ids.length) return [];
  const org = ctx.organizationId;
  const column = kind === "delivery" ? outputStockAllocations.deliveryId
    : kind === "productionRun" ? outputStockAllocations.productionRunId : outputStockAllocations.biocharProductId;
  const rows = await db.select({
    runId: outputStockAllocations.productionRunId, productId: outputStockAllocations.biocharProductId,
    deliveryId: outputStockAllocations.deliveryId,
    dryKg: sql<string>`sum(${outputStockAllocations.dryMassKg})`,
    wetKg: sql<string | null>`case when count(*) = count(${outputStockAllocations.wetMassKg}) then sum(${outputStockAllocations.wetMassKg}) end`,
  }).from(outputStockAllocations)
    .innerJoin(binMovements, and(eq(binMovements.organizationId, org), eq(binMovements.id, outputStockAllocations.movementId)))
    .where(and(eq(outputStockAllocations.organizationId, org), inArray(column, ids),
      isNotNull(outputStockAllocations.deliveryId), liveOutputDraw(ctx, db)))
    .groupBy(outputStockAllocations.productionRunId, outputStockAllocations.biocharProductId, outputStockAllocations.deliveryId)
    .having(or(gt(sql`sum(${outputStockAllocations.dryMassKg})`, 0), gt(sql`sum(${outputStockAllocations.wetMassKg})`, 0)));
  return rows.flatMap(row => {
    if (!row.deliveryId) return [];
    const sourceKind = row.runId ? "productionRun" : "biocharProduct";
    const sourceId = row.runId ?? row.productId;
    if (!sourceId) return [];
    // A run's share is dry biochar. Product wet mass includes its blend and water.
    const mass = sourceKind === "biocharProduct" && row.wetKg !== null
      ? usedByMass(Number(row.wetKg), "wet") : usedByMass(Number(row.dryKg), "dryBiochar");
    return [usedByEdge(sourceKind, sourceId, "delivery", row.deliveryId, mass)];
  });
}
