import {
  and,
  eq,
  exists,
  isNull,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { db } from "@/db";
import {
  biocharProductSourceAllocations,
  biocharProducts,
  creditBatchProductionRuns,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

/**
 * Correlates a delivery/application biochar product with a credit batch through
 * the batch's production-run membership. This is the same lineage used by
 * credit-batch accounting, so operational list filters cannot drift from the
 * certification checklist.
 */
export function inCreditBatchLineage(
  ctx: OrgContext,
  creditBatchId: string,
  biocharProductId: SQLWrapper,
): SQL {
  requireOrgScope(ctx);

  return exists(
    db
      .select({ value: sql`1` })
      .from(creditBatchProductionRuns)
      .leftJoin(
        biocharProductSourceAllocations,
        and(
          eq(
            biocharProductSourceAllocations.productionRunId,
            creditBatchProductionRuns.productionRunId,
          ),
          eq(
            biocharProductSourceAllocations.organizationId,
            ctx.organizationId,
          ),
        ),
      )
      .innerJoin(
        biocharProducts,
        and(
          or(
            eq(
              biocharProducts.id,
              biocharProductSourceAllocations.biocharProductId,
            ),
            and(
              isNull(biocharProducts.sourceBiocharStorageLocationId),
              eq(
                biocharProducts.linkedProductionRunId,
                creditBatchProductionRuns.productionRunId,
              ),
            ),
          )!,
          eq(biocharProducts.organizationId, ctx.organizationId),
          eq(biocharProducts.id, biocharProductId),
        ),
      )
      .where(
        and(
          eq(creditBatchProductionRuns.creditBatchId, creditBatchId),
          eq(
            creditBatchProductionRuns.organizationId,
            ctx.organizationId,
          ),
        ),
      ),
  );
}

/** Filters production runs to the explicit membership of one credit batch. */
export function inCreditBatchProductionRuns(
  ctx: OrgContext,
  creditBatchId: string,
  productionRunId: SQLWrapper,
): SQL {
  requireOrgScope(ctx);

  return exists(
    db
      .select({ value: sql`1` })
      .from(creditBatchProductionRuns)
      .where(
        and(
          eq(creditBatchProductionRuns.creditBatchId, creditBatchId),
          eq(
            creditBatchProductionRuns.organizationId,
            ctx.organizationId,
          ),
          eq(creditBatchProductionRuns.productionRunId, productionRunId),
        ),
      ),
  );
}
