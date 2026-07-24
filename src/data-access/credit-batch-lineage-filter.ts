import {
  and,
  eq,
  exists,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { db } from "@/db";
import {
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
      .innerJoin(
        biocharProducts,
        and(
          eq(
            biocharProducts.linkedProductionRunId,
            creditBatchProductionRuns.productionRunId,
          ),
          eq(biocharProducts.organizationId, ctx.organizationId),
        ),
      )
      .where(
        and(
          eq(creditBatchProductionRuns.creditBatchId, creditBatchId),
          eq(
            creditBatchProductionRuns.organizationId,
            ctx.organizationId,
          ),
          eq(biocharProducts.id, biocharProductId),
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
