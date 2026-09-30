/**
 * Chain of custody — run roll-forwards.
 *
 * The roll-up's application rollbacks only reach runs whose biochar has been
 * applied. A roll-forward starts at a member production run instead and walks
 * downstream to wherever its biochar is now: the product layers drawn from the
 * run, then the deliveries that shipped those layers. It stops at the last
 * recorded step, so a credit batch is traceable before its first application.
 *
 * Two set-based queries regardless of run count.
 */
import { db } from "@/db";
import {
  biocharProducts,
  biocharProductSourceAllocations,
  deliveries,
  formulations,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { and, eq, inArray } from "drizzle-orm";
import {
  CHAIN_HREFS,
  sourceLineageFromRunFact,
  type ChainBiocharProductLineage,
  type ChainDeliveryLineage,
  type ChainSourceLineage,
} from "./chain-of-custody";
import type { BatchLineageRunFact } from "./credit-batch-lineage-types";
import { deliveryProductAllocations } from "./delivery-allocation-provenance";
import { requireOrgScope } from "./utils";

export interface ChainRollForwardDelivery {
  delivery: ChainDeliveryLineage;
  /** Net product-layer mass this delivery shipped (reversals already netted). */
  wetMassKg: number | null;
  dryMassKg: number;
}

export interface ChainRollForwardProduct {
  product: ChainBiocharProductLineage;
  /** Biochar drawn from the run into this product, on both mass bases. */
  drawnWetMassKg: number;
  drawnDryMassKg: number;
  deliveries: ChainRollForwardDelivery[];
}

export interface ChainRunRollForward {
  /** The run's upstream block; its allocated masses stay null. */
  source: ChainSourceLineage;
  products: ChainRollForwardProduct[];
}

export async function loadRunRollForwards(
  ctx: OrgContext,
  runs: BatchLineageRunFact[],
): Promise<ChainRunRollForward[]> {
  requireOrgScope(ctx);
  const runIds = runs.map((run) => run.id);
  if (runIds.length === 0) return [];

  const productRows = await db
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
  const layers = deliveryProductAllocations(ctx);
  const deliveryRows = productIds.length
    ? await db
        .select({
          biocharProductId: layers.biocharProductId,
          wetMassKg: layers.wetMassKg,
          dryMassKg: layers.dryMassKg,
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

  const deliveriesByProduct = new Map<string, ChainRollForwardDelivery[]>();
  for (const row of deliveryRows) {
    if (!row.biocharProductId) continue;
    const list = deliveriesByProduct.get(row.biocharProductId) ?? [];
    list.push({
      delivery: {
        id: row.id,
        code: row.code,
        status: row.status,
        deliveryDate: row.deliveryDate,
        deliveredWetMassKg: row.deliveredWetMassKg,
        massDryKg: row.massDryKg,
        href: CHAIN_HREFS.delivery,
      },
      wetMassKg: row.wetMassKg,
      dryMassKg: row.dryMassKg,
    });
    deliveriesByProduct.set(row.biocharProductId, list);
  }

  const productsByRun = new Map<string, ChainRollForwardProduct[]>();
  for (const row of productRows) {
    const list = productsByRun.get(row.productionRunId) ?? [];
    list.push({
      product: {
        id: row.id,
        code: row.code,
        status: row.status,
        productionDate: row.productionDate,
        massKg: row.massKg,
        moistureContentPercent: row.moistureContentPercent,
        formulationName: row.formulationName,
        linkedProductionRunId: row.productionRunId,
        href: CHAIN_HREFS.biocharProduct,
      },
      drawnWetMassKg: row.drawnWetMassKg,
      drawnDryMassKg: row.drawnDryMassKg,
      deliveries: (deliveriesByProduct.get(row.id) ?? []).sort((a, b) =>
        a.delivery.code.localeCompare(b.delivery.code),
      ),
    });
    productsByRun.set(row.productionRunId, list);
  }

  return runs.map((run) => ({
    source: sourceLineageFromRunFact(run, null),
    products: (productsByRun.get(run.id) ?? []).sort((a, b) =>
      a.product.code.localeCompare(b.product.code),
    ),
  }));
}
