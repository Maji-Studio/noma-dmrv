import { db } from "@/db";
import {
  biocharProductSourceAllocations,
  biocharProducts,
  creditBatchProductionRuns,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
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
import { requireOrgScope } from "./utils";

/**
 * Correlates a product-list row with a credit batch through
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

/** Delivery membership comes exclusively from net posted source-run effects. */
export function inDeliveryCreditBatchLineage(ctx: OrgContext, creditBatchId: string, deliveryId: SQLWrapper): SQL {
  requireOrgScope(ctx);
  return sql`exists (
    select 1 from output_stock_allocations osa
    join output_stock_run_allocations osra on osra.allocation_id = osa.id and osra.organization_id = ${ctx.organizationId}
    join credit_batch_production_runs cbpr on cbpr.production_run_id = osra.production_run_id and cbpr.organization_id = ${ctx.organizationId}
    join deliveries source_delivery on source_delivery.id = osa.delivery_id and source_delivery.organization_id = ${ctx.organizationId}
      and source_delivery.storage_location_id = osa.source_storage_location_id
    join production_runs source_run on source_run.id = osra.production_run_id and source_run.organization_id = ${ctx.organizationId}
      and source_run.facility_id = source_delivery.facility_id
    join biochar_products source_product on source_product.id = osa.biochar_product_id and source_product.organization_id = ${ctx.organizationId}
      and source_product.facility_id = source_delivery.facility_id
    where osa.organization_id = ${ctx.organizationId} and osa.delivery_id = ${deliveryId}
      and cbpr.credit_batch_id = ${creditBatchId}
    group by osa.biochar_product_id, osra.production_run_id
    having sum(osra.dry_mass_kg) > 0
  )`;
}
