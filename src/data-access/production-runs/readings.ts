/**
 * Production-run reading (time-series) operations.
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { productionRuns, productionRunReadings } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "../utils";
import { SafeError } from "@/lib/errors";
import type { ProductionRunReadingRecord } from "./types";

/**
 * Get production run readings (time-series data)
 */
export async function getProductionRunReadings(
  ctx: OrgContext,
  productionRunId: string
): Promise<ProductionRunReadingRecord[]> {
  requireOrgScope(ctx);

  // Verify run exists
  const [run] = await db
    .select({ id: productionRuns.id })
    .from(productionRuns)
    .where(and(eq(productionRuns.id, productionRunId), eq(productionRuns.organizationId, ctx.organizationId)));

  if (!run) {
    throw new SafeError("Production run not found");
  }

  return db
    .select()
    .from(productionRunReadings)
    .where(and(eq(productionRunReadings.productionRunId, productionRunId), eq(productionRunReadings.organizationId, ctx.organizationId)))
    .orderBy(asc(productionRunReadings.timestamp));
}
