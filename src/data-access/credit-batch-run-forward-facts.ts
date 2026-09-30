/**
 * Run-forward facts for the consolidated credit-batch roll-up loader.
 *
 * Internal to `credit-batch-accounting.ts` (`includeRunForwards`): member run
 * ids in, per-run product layers and delivery shares out, read on the loader's
 * own executor so they share its snapshot. Delivery shares are at run grain
 * (saved delivery provenance), so a product blended from several runs never
 * credits one run with another run's shipped biochar.
 */
import { db, type DbTransaction } from "@/db";
import {
  biocharProducts,
  biocharProductSourceAllocations,
  deliveries,
  formulations,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { splitWetMass } from "@/lib/mass-moisture";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type {
  BatchRunForwardDeliveryFact,
  BatchRunForwardProductFact,
} from "./credit-batch-lineage-types";
import {
  deliveryProductAllocations,
  getDeliveryAllocationProvenance,
} from "./delivery-allocation-provenance";
import { requireOrgScope } from "./utils";

type Executor = DbTransaction | typeof db;

export async function loadRunForwardFactsWithExecutor(
  ctx: OrgContext,
  runIds: string[],
  executor: Executor,
): Promise<Record<string, BatchRunForwardProductFact[]>> {
  requireOrgScope(ctx);
  if (runIds.length === 0) return {};

  const productRows = await executor
    .select({
      productionRunId: biocharProductSourceAllocations.productionRunId,
      drawnWetMassKg: biocharProductSourceAllocations.allocatedWetMassKg,
      drawnDryMassKg: biocharProductSourceAllocations.allocatedDryMassKg,
      id: biocharProducts.id,
      code: biocharProducts.code,
      status: biocharProducts.status,
      productionDate: biocharProducts.productionDate,
      massKg: biocharProducts.massKg,
      moistureContentPercent: biocharProducts.moistureContentPercent,
      formulationName: formulations.name,
    })
    .from(biocharProductSourceAllocations)
    .innerJoin(
      biocharProducts,
      and(
        eq(biocharProductSourceAllocations.biocharProductId, biocharProducts.id),
        eq(biocharProducts.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      formulations,
      and(
        eq(biocharProducts.formulationId, formulations.id),
        eq(formulations.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        inArray(biocharProductSourceAllocations.productionRunId, runIds),
        eq(biocharProductSourceAllocations.organizationId, ctx.organizationId),
      ),
    );

  // Legacy products carry no source allocation: they link to their run
  // directly, the same branch credit-batch-lineage-filter.ts accepts.
  const legacyRows = await executor
    .select({
      productionRunId: biocharProducts.linkedProductionRunId,
      id: biocharProducts.id,
      code: biocharProducts.code,
      status: biocharProducts.status,
      productionDate: biocharProducts.productionDate,
      massKg: biocharProducts.massKg,
      moistureContentPercent: biocharProducts.moistureContentPercent,
      formulationName: formulations.name,
    })
    .from(biocharProducts)
    .leftJoin(
      formulations,
      and(
        eq(biocharProducts.formulationId, formulations.id),
        eq(formulations.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        eq(biocharProducts.organizationId, ctx.organizationId),
        isNull(biocharProducts.sourceBiocharStorageLocationId),
        inArray(biocharProducts.linkedProductionRunId, runIds),
      ),
    );
  const allocated = new Set(productRows.map((row) => `${row.productionRunId}:${row.id}`));
  const drawnRows: Array<
    Omit<(typeof productRows)[number], "drawnWetMassKg" | "drawnDryMassKg"> & {
      drawnWetMassKg: number | null;
      drawnDryMassKg: number | null;
    }
  > = [
    ...productRows,
    ...legacyRows.flatMap(({ productionRunId, ...row }) => {
      if (!productionRunId || allocated.has(`${productionRunId}:${row.id}`)) return [];
      // The whole legacy lot came from its one linked run.
      const split = splitWetMass(row.massKg, row.moistureContentPercent);
      return [{ ...row, productionRunId, drawnWetMassKg: row.massKg, drawnDryMassKg: split?.dryKg ?? null }];
    }),
  ];

  const productIds = [...new Set(drawnRows.map((row) => row.id))];
  const layers = deliveryProductAllocations(ctx, executor);
  const deliveryRows = productIds.length
    ? await executor
        .selectDistinct({
          id: deliveries.id,
          code: deliveries.code,
          status: deliveries.status,
          deliveryDate: deliveries.deliveryDate,
          deliveredWetMassKg: deliveries.deliveredWetMassKg,
          massDryKg: deliveries.massDryKg,
        })
        .from(layers)
        .innerJoin(
          deliveries,
          and(
            eq(deliveries.id, layers.deliveryId),
            eq(deliveries.organizationId, ctx.organizationId),
          ),
        )
        .where(inArray(layers.biocharProductId, productIds))
    : [];
  // The saved-provenance reader owns the run split: gram-exact wet
  // apportionment across every source run, zero-dry wet residuals kept by
  // their frozen weights, and fail-closed on unbalanced allocations.
  const shares = await getDeliveryAllocationProvenance(
    ctx,
    deliveryRows.map((row) => row.id),
    executor,
  );

  const memberRunIds = new Set(runIds);
  const deliveryById = new Map(deliveryRows.map((row) => [row.id, row]));
  const deliveriesByRunProduct = new Map<string, BatchRunForwardDeliveryFact[]>();
  for (const share of shares) {
    const delivery = deliveryById.get(share.deliveryId);
    if (!delivery || !memberRunIds.has(share.productionRunId)) continue;
    if (share.dryMassKg <= 0 && share.wetMassKg <= 0) continue;
    const key = `${share.productionRunId}:${share.biocharProductId}`;
    const list = deliveriesByRunProduct.get(key) ?? [];
    list.push({ ...delivery, wetMassKg: share.wetMassKg, dryMassKg: share.dryMassKg });
    deliveriesByRunProduct.set(key, list);
  }

  const byRun: Record<string, BatchRunForwardProductFact[]> = {};
  for (const row of drawnRows) {
    (byRun[row.productionRunId] ??= []).push({
      id: row.id,
      code: row.code,
      status: row.status,
      productionDate: row.productionDate,
      massKg: row.massKg,
      moistureContentPercent: row.moistureContentPercent,
      formulationName: row.formulationName,
      drawnWetMassKg: row.drawnWetMassKg,
      drawnDryMassKg: row.drawnDryMassKg,
      deliveries: (deliveriesByRunProduct.get(`${row.productionRunId}:${row.id}`) ?? [])
        .sort((a, b) => a.code.localeCompare(b.code)),
    });
  }
  for (const products of Object.values(byRun)) {
    products.sort((a, b) => a.code.localeCompare(b.code));
  }
  return byRun;
}
