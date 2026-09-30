/**
 * Run-forward facts for the consolidated credit-batch roll-up loader.
 *
 * Internal to `credit-batch-accounting.ts` (`includeRunForwards`): member run
 * ids in, per-run product layers and delivery shares out, read on the loader's
 * own executor so they share its snapshot. Delivery shares are at run grain
 * (`output_stock_run_allocations`), so a product blended from several runs
 * never credits one run with another run's shipped biochar.
 *
 * Three set-based queries regardless of run count.
 */
import { db, type DbTransaction } from "@/db";
import {
  biocharProducts,
  biocharProductSourceAllocations,
  deliveries,
  formulations,
  outputStockAllocations,
  outputStockRunAllocations,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import type {
  BatchRunForwardDeliveryFact,
  BatchRunForwardProductFact,
} from "./credit-batch-lineage-types";
import { GRAMS_PER_KG } from "./delivery-allocation-math";
import { deliveryProductAllocations } from "./delivery-allocation-provenance";
import { requireOrgScope } from "./utils";

type Executor = DbTransaction | typeof db;

/** Round a derived kg figure to the gram, the ledger's precision. */
const toGram = (kg: number) => Math.round(kg * GRAMS_PER_KG) / GRAMS_PER_KG;

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

  const productIds = [...new Set(productRows.map((row) => row.id))];
  const [runShares, layerRows] = productIds.length
    ? await Promise.all([
        executor
          .select({
            deliveryId: outputStockAllocations.deliveryId,
            biocharProductId: outputStockAllocations.biocharProductId,
            productionRunId: outputStockRunAllocations.productionRunId,
            dryMassKg: sql<number>`sum(${outputStockRunAllocations.dryMassKg})`.mapWith(Number),
          })
          .from(outputStockAllocations)
          .innerJoin(
            outputStockRunAllocations,
            and(
              eq(outputStockRunAllocations.allocationId, outputStockAllocations.id),
              eq(outputStockRunAllocations.organizationId, ctx.organizationId),
            ),
          )
          .innerJoin(
            deliveries,
            and(
              eq(deliveries.id, outputStockAllocations.deliveryId),
              eq(deliveries.organizationId, ctx.organizationId),
              eq(deliveries.storageLocationId, outputStockAllocations.sourceStorageLocationId),
            ),
          )
          .where(
            and(
              eq(outputStockAllocations.organizationId, ctx.organizationId),
              inArray(outputStockAllocations.biocharProductId, productIds),
              inArray(outputStockRunAllocations.productionRunId, runIds),
            ),
          )
          .groupBy(
            outputStockAllocations.deliveryId,
            outputStockAllocations.biocharProductId,
            outputStockRunAllocations.productionRunId,
          )
          .having(sql`sum(${outputStockRunAllocations.dryMassKg}) > 0`),
        (() => {
          const layers = deliveryProductAllocations(ctx, executor);
          return executor
            .select({
              biocharProductId: layers.biocharProductId,
              layerWetMassKg: layers.wetMassKg,
              layerDryMassKg: layers.dryMassKg,
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
            .where(inArray(layers.biocharProductId, productIds));
        })(),
      ])
    : [[], []];

  const layerByKey = new Map(
    layerRows.map((row) => [`${row.id}:${row.biocharProductId}`, row]),
  );
  const deliveriesByRunProduct = new Map<string, BatchRunForwardDeliveryFact[]>();
  for (const share of runShares) {
    const layer = layerByKey.get(`${share.deliveryId}:${share.biocharProductId}`);
    // No net layer: the shipment was reversed away, nothing left to show.
    if (!layer) continue;
    // Wet mass follows the run's dry share of the layer, as in provenance.
    const wetMassKg =
      layer.layerWetMassKg != null && layer.layerDryMassKg > 0
        ? toGram((layer.layerWetMassKg * share.dryMassKg) / layer.layerDryMassKg)
        : null;
    const key = `${share.productionRunId}:${share.biocharProductId}`;
    const list = deliveriesByRunProduct.get(key) ?? [];
    list.push({
      id: layer.id,
      code: layer.code,
      status: layer.status,
      deliveryDate: layer.deliveryDate,
      deliveredWetMassKg: layer.deliveredWetMassKg,
      massDryKg: layer.massDryKg,
      wetMassKg,
      dryMassKg: share.dryMassKg,
    });
    deliveriesByRunProduct.set(key, list);
  }

  const byRun: Record<string, BatchRunForwardProductFact[]> = {};
  for (const row of productRows) {
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
