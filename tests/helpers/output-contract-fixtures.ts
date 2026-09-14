import type { OrgContext } from "@/lib/auth/server";
import { randomUUID } from "node:crypto";
import { eq, inArray, type SQL } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  biocharProducts, biocharProductSourceAllocations, binMovements, deliveries,
  formulations, orders, outputStockAllocations, outputStockRunAllocations,
  applicationOutputAllocations, applications, facilities, productionRuns,
  reactors, storageLocations, users, type Delivery,
} from "@/db/schema";

type Executor = typeof db | DbTransaction;
type ProductValues = typeof biocharProducts.$inferInsert;
type OrderValues = typeof orders.$inferInsert;
type DeliveryValues = typeof deliveries.$inferInsert;
type ProductFixture = Omit<ProductValues, "placedAt" | "formulationId"> & {
  placedAt?: string;
  formulationId?: string | null;
};
type OrderFixture = Omit<OrderValues, "formulationId"> & {
  formulationId?: string;
  biocharProductId?: string;
};
type DeliveryFixture = Omit<DeliveryValues, "storageLocationId"> & { storageLocationId?: string };
const FIXTURE_PLACED_AT = "2025-01-01";
const sourceByOrder = new Map<string, string>();
const ownedBins = new Set<string>();
const ownedRuns = new Set<string>();
const ownedReactors = new Set<string>();
const ownedFormulations = new Set<string>();
const GRAMS_PER_KG = 1_000;
const GRAMS_PER_TONNE = 1_000_000;
const PERCENT_SCALE = 100;

/** Consumer fixtures declare facts directly; stock writer tests must use preview/post. */
async function productFixture(executor: Executor, input: ProductFixture): Promise<ProductValues> {
  let formulationId = input.formulationId;
  if (!formulationId) {
    const [recipe] = await executor.insert(formulations).values({
      organizationId: input.organizationId, code: `E2E-RECIPE-${randomUUID()}`,
      name: "E2E Pure fixture", biocharRatio: 1,
    }).returning();
    formulationId = recipe.id;
    ownedFormulations.add(recipe.id);
  }
  const placedAt = input.placedAt ?? input.productionDate?.toISOString().slice(0, 10) ?? FIXTURE_PLACED_AT;
  return { ...input, formulationId, placedAt };
}
export function outputProductFixtureValues(executor: Executor, input: ProductFixture): Promise<ProductValues>;
export function outputProductFixtureValues(executor: Executor, input: ProductFixture[]): Promise<ProductValues[]>;
export async function outputProductFixtureValues(executor: Executor, input: ProductFixture | ProductFixture[]) {
  return Array.isArray(input) ? Promise.all(input.map(row => productFixture(executor, row))) : productFixture(executor, input);
}

async function orderFixture(executor: Executor, input: OrderFixture): Promise<OrderValues> {
  const { biocharProductId, ...values } = input;
  const id = values.id ?? randomUUID();
  let formulationId = input.formulationId;
  if (biocharProductId) {
    const [product] = await executor.select().from(biocharProducts).where(eq(biocharProducts.id, biocharProductId));
    if (!product) throw new Error("Fixture product must exist before its order");
    formulationId ??= product.formulationId;
    sourceByOrder.set(id, biocharProductId);
  }
  if (!formulationId) throw new Error("Fixture order requires a formulation");
  return { ...values, id, formulationId };
}
export function outputOrderFixtureValues(executor: Executor, input: OrderFixture): Promise<OrderValues>;
export function outputOrderFixtureValues(executor: Executor, input: OrderFixture[]): Promise<OrderValues[]>;
export async function outputOrderFixtureValues(executor: Executor, input: OrderFixture | OrderFixture[]) {
  return Array.isArray(input) ? Promise.all(input.map(row => orderFixture(executor, row))) : orderFixture(executor, input);
}

async function ensureProductBin(executor: Executor, product: typeof biocharProducts.$inferSelect) {
  if (product.storageLocationId) return product.storageLocationId;
  const [bin] = await executor.insert(storageLocations).values({
    organizationId: product.organizationId, facilityId: product.facilityId,
    formulationId: product.formulationId, type: "product_bin",
    code: `E2E-BIN-${randomUUID()}`, name: `E2E Product fixture ${randomUUID()}`,
  }).returning();
  ownedBins.add(bin.id);
  await executor.update(biocharProducts).set({ storageLocationId: bin.id }).where(eq(biocharProducts.id, product.id));
  return bin.id;
}

async function persistFixtureProvenance(executor: Executor, delivery: Delivery, productId: string | undefined) {
  // Null dry mass deliberately represents unresolved evidence in some tests.
  if (!productId || delivery.massDryKg == null || delivery.deliveredWetMassKg == null) return;
  const [product] = await executor.select().from(biocharProducts).where(eq(biocharProducts.id, productId));
  if (!product) throw new Error("Fixture source product is missing");
  const sources = await executor.select().from(biocharProductSourceAllocations).where(eq(biocharProductSourceAllocations.biocharProductId, product.id));
  let runShares = sources.map(source => ({ id: source.productionRunId, dry: source.allocatedDryMassKg }));
  if (!runShares.length && product.linkedProductionRunId) runShares = [{ id: product.linkedProductionRunId, dry: delivery.massDryKg }];
  if (!runShares.length) {
    const [reactor] = await executor.insert(reactors).values({ organizationId: product.organizationId, facilityId: product.facilityId, code: `E2E-REACTOR-${randomUUID()}`, identifier: `E2E Fixture reactor ${randomUUID()}`, reactorType: "auger" }).returning();
    ownedReactors.add(reactor.id);
    const [run] = await executor.insert(productionRuns).values({ organizationId: product.organizationId, facilityId: product.facilityId, reactorId: reactor.id, code: `E2E-RUN-${randomUUID()}`, status: "complete", startTime: new Date(`${product.placedAt}T00:00:00Z`), biocharDryMassKg: delivery.massDryKg }).returning();
    ownedRuns.add(run.id);
    runShares = [{ id: run.id, dry: delivery.massDryKg }];
  }
  const dry = delivery.massDryKg;
  const [movement] = await executor.insert(binMovements).values({ organizationId: delivery.organizationId, storageLocationId: delivery.storageLocationId, lane: "product", movementType: "adjustment", massDeltaKg: -delivery.deliveredWetMassKg, reason: "Saved consumer-test fixture", outputKind: "delivery", physicalDate: delivery.deliveryDate.toISOString().slice(0, 10), idempotencyKey: randomUUID(), basisFingerprint: "fixture-snapshot", inputSnapshot: { kind: "delivery", deliveryId: delivery.id, wetMassKg: delivery.deliveredWetMassKg, moisturePercent: delivery.moistureContentPercent }, outputDryDeltaKg: String(-dry), balanceBeforeDryKg: String(dry), balanceAfterDryKg: "0" }).returning();
  const [allocation] = await executor.insert(outputStockAllocations).values({ organizationId: delivery.organizationId, movementId: movement.id, sourceStorageLocationId: delivery.storageLocationId, biocharProductId: product.id, deliveryId: delivery.id, dryMassKg: String(dry), wetMassKg: String(delivery.deliveredWetMassKg), basisSnapshot: { fixture: true, solidsKg: { numerator: String(Math.round(dry * GRAMS_PER_KG)), denominator: String(GRAMS_PER_KG) } } }).returning();
  const sourceTotal = runShares.reduce((sum, source) => sum + source.dry, 0);
  let allocatedGrams = 0;
  for (const [index, source] of runShares.entries()) {
    const grams = index === runShares.length - 1 ? Math.round(dry * GRAMS_PER_KG) - allocatedGrams : Math.round(dry * GRAMS_PER_KG * source.dry / sourceTotal);
    allocatedGrams += grams;
    await executor.insert(outputStockRunAllocations).values({ organizationId: delivery.organizationId, allocationId: allocation.id, productionRunId: source.id, dryMassKg: String(grams / GRAMS_PER_KG) });
  }
}

export async function insertOutputDeliveryFixture<T>(executor: Executor, input: DeliveryFixture | DeliveryFixture[], select: (row: Delivery) => T): Promise<T[]> {
  const result: T[] = [];
  for (const values of Array.isArray(input) ? input : [input]) {
    const [order] = await executor.select().from(orders).where(eq(orders.id, values.orderId));
    if (!order) throw new Error("Fixture order is missing");
    const productId = values.biocharProductId ?? sourceByOrder.get(values.orderId);
    const [product] = productId ? await executor.select().from(biocharProducts).where(eq(biocharProducts.id, productId)) : [];
    let storageLocationId = values.storageLocationId ?? (product ? await ensureProductBin(executor, product) : undefined);
    if (!storageLocationId) {
      const [bin] = await executor.insert(storageLocations).values({ organizationId: values.organizationId, facilityId: values.facilityId, formulationId: order.formulationId, type: "product_bin", code: `E2E-BIN-${randomUUID()}`, name: `E2E Delivery fixture ${randomUUID()}` }).returning();
      ownedBins.add(bin.id);
      storageLocationId = bin.id;
    }
    const [saved] = await executor.insert(deliveries).values({ ...values, storageLocationId, status: "delivered" }).returning();
    await persistFixtureProvenance(executor, saved, productId);
    result.push(select(saved));
  }
  return result;
}

/** Remove new journal children before existing fixture cleanup deletes parents. */
export async function deleteOutputDeliveryFixtures(executor: Executor, predicate: SQL | undefined) {
  const rows = await executor.select({ id: deliveries.id }).from(deliveries).where(predicate);
  if (rows.length) {
    const ids = rows.map(row => row.id);
    const allocations = await executor.select({ id: outputStockAllocations.id, movementId: outputStockAllocations.movementId }).from(outputStockAllocations).where(inArray(outputStockAllocations.deliveryId, ids));
    await executor.delete(applicationOutputAllocations).where(inArray(applicationOutputAllocations.deliveryId, ids));
    if (allocations.length) {
      await executor.delete(outputStockRunAllocations).where(inArray(outputStockRunAllocations.allocationId, allocations.map(row => row.id)));
      await executor.delete(outputStockAllocations).where(inArray(outputStockAllocations.id, allocations.map(row => row.id)));
      await executor.delete(binMovements).where(inArray(binMovements.id, allocations.map(row => row.movementId)));
    }
  }
  return executor.delete(deliveries).where(predicate);
}

export async function cleanupOutputFixtureParents(executor: Executor, facilityId: string) {
  const runs = await executor.select({ id: productionRuns.id }).from(productionRuns).where(eq(productionRuns.facilityId, facilityId));
  const ownRunIds = runs.map(row => row.id).filter(id => ownedRuns.has(id));
  if (ownRunIds.length) await executor.delete(productionRuns).where(inArray(productionRuns.id, ownRunIds));
  const reactorRows = await executor.select({ id: reactors.id }).from(reactors).where(eq(reactors.facilityId, facilityId));
  const ownReactorIds = reactorRows.map(row => row.id).filter(id => ownedReactors.has(id));
  if (ownReactorIds.length) await executor.delete(reactors).where(inArray(reactors.id, ownReactorIds));
  const bins = await executor.select({ id: storageLocations.id }).from(storageLocations).where(eq(storageLocations.facilityId, facilityId));
  const ownBinIds = bins.map(row => row.id).filter(id => ownedBins.has(id));
  if (ownBinIds.length) await executor.delete(storageLocations).where(inArray(storageLocations.id, ownBinIds));
}

export async function deleteOutputProductFixtures(executor: Executor, predicate: SQL | undefined) {
  const products = await executor.select().from(biocharProducts).where(predicate);
  const productIds = products.map(product => product.id);
  if (productIds.length) {
    const draws = await executor.select().from(outputStockAllocations).where(inArray(outputStockAllocations.targetBiocharProductId, productIds));
    if (draws.length) {
      await executor.delete(outputStockRunAllocations).where(inArray(outputStockRunAllocations.allocationId, draws.map(draw => draw.id)));
      await executor.delete(outputStockAllocations).where(inArray(outputStockAllocations.id, draws.map(draw => draw.id)));
      await executor.delete(binMovements).where(inArray(binMovements.id, draws.map(draw => draw.movementId)));
    }
  }
  const sourcedIds = products.map(product => product.id);
  if (sourcedIds.length) await executor.delete(biocharProductSourceAllocations).where(inArray(biocharProductSourceAllocations.biocharProductId, sourcedIds));
  const result = await executor.delete(biocharProducts).where(predicate);
  for (const product of products) {
    if (!product.storageLocationId || !ownedBins.has(product.storageLocationId)) continue;
    const [otherProduct] = await executor.select({ id: biocharProducts.id }).from(biocharProducts).where(eq(biocharProducts.storageLocationId, product.storageLocationId));
    const [otherDelivery] = await executor.select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.storageLocationId, product.storageLocationId));
    if (!otherProduct && !otherDelivery) await executor.delete(storageLocations).where(eq(storageLocations.id, product.storageLocationId));
  }
  for (const formulationId of new Set(products.map(product => product.formulationId))) {
    if (!ownedFormulations.has(formulationId)) continue;
    const [product] = await executor.select({ id: biocharProducts.id }).from(biocharProducts).where(eq(biocharProducts.formulationId, formulationId));
    const [order] = await executor.select({ id: orders.id }).from(orders).where(eq(orders.formulationId, formulationId));
    const [bin] = await executor.select({ id: storageLocations.id }).from(storageLocations).where(eq(storageLocations.formulationId, formulationId));
    if (!product && !order && !bin) await executor.delete(formulations).where(eq(formulations.id, formulationId));
  }
  return result;
}

export async function deleteOutputFacilityFixtures(executor: Executor, predicate: SQL | undefined) {
  const rows = await executor.select({ id: facilities.id }).from(facilities).where(predicate);
  for (const row of rows) await cleanupOutputFixtureParents(executor, row.id);
  return executor.delete(facilities).where(predicate);
}

export async function deleteOutputApplicationFixtures(executor: Executor, predicate: SQL | undefined) {
  const rows = await executor.select({ id: applications.id }).from(applications).where(predicate);
  if (rows.length) await executor.delete(applicationOutputAllocations).where(inArray(applicationOutputAllocations.applicationId, rows.map(row => row.id)));
  return executor.delete(applications).where(predicate);
}

/** Freeze explicitly declared historical application shares, including deliberately invalid guard fixtures. */
export async function insertOutputApplicationFixture<T>(executor: Executor, input: typeof applications.$inferInsert | (typeof applications.$inferInsert)[], select: (row: typeof applications.$inferSelect) => T): Promise<T[]> {
  const result: T[] = [];
  for (const values of Array.isArray(input) ? input : [input]) {
    const [application] = await executor.insert(applications).values(values).returning();
    const sources = await executor.select({ productId: outputStockAllocations.biocharProductId, runId: outputStockRunAllocations.productionRunId, dry: outputStockRunAllocations.dryMassKg }).from(outputStockAllocations).innerJoin(outputStockRunAllocations, eq(outputStockRunAllocations.allocationId, outputStockAllocations.id)).where(eq(outputStockAllocations.deliveryId, application.deliveryId));
    const total = sources.reduce((sum, source) => sum + Number(source.dry), 0);
    let dryGrams = 0;
    let wetGrams = 0;
    for (const [index, source] of sources.entries()) {
      if (!source.productId || !total || application.biocharAppliedDryTons == null) continue;
      const last = index === sources.length - 1;
      const dry = last ? Math.round(application.biocharAppliedDryTons * GRAMS_PER_TONNE) - dryGrams : Math.round(application.biocharAppliedDryTons * GRAMS_PER_TONNE * Number(source.dry) / total);
      const wet = last ? Math.round(application.biocharAppliedTons * GRAMS_PER_TONNE) - wetGrams : Math.round(application.biocharAppliedTons * GRAMS_PER_TONNE * Number(source.dry) / total);
      dryGrams += dry;
      wetGrams += wet;
      await executor.insert(applicationOutputAllocations).values({ organizationId: application.organizationId, applicationId: application.id, deliveryId: application.deliveryId, biocharProductId: source.productId, productionRunId: source.runId, wetMassKg: String(wet / GRAMS_PER_KG), dryMassKg: String(dry / GRAMS_PER_KG) });
    }
    result.push(select(application));
  }
  return result;
}

/** Establish a pure product layer for tests that exercise the real delivery writer. */
export async function preparePureOutputProductFixture(executor: Executor, productId: string) {
  const [product] = await executor.select().from(biocharProducts).where(eq(biocharProducts.id, productId));
  if (!product || product.massKg == null || product.moistureContentPercent == null) throw new Error("Pure writer fixture requires measured product mass and moisture");
  const storageLocationId = await ensureProductBin(executor, product);
  const [existing] = await executor.select().from(biocharProductSourceAllocations).where(eq(biocharProductSourceAllocations.biocharProductId, product.id));
  if (existing) return { storageLocationId, formulationId: product.formulationId };
  let run = product.linkedProductionRunId ? (await executor.select().from(productionRuns).where(eq(productionRuns.id, product.linkedProductionRunId)))[0] : undefined;
  let sourceStorageLocationId = run?.biocharStorageLocationId ?? undefined;
  if (!sourceStorageLocationId) {
    const [sourceBin] = await executor.insert(storageLocations).values({ organizationId: product.organizationId, facilityId: product.facilityId, type: "biochar_bin", code: `E2E-SOURCE-${randomUUID()}`, name: `E2E Source ${randomUUID()}` }).returning();
    ownedBins.add(sourceBin.id);
    sourceStorageLocationId = sourceBin.id;
  }
  const dryKg = Math.round(product.massKg * (1 - product.moistureContentPercent / PERCENT_SCALE) * GRAMS_PER_KG) / GRAMS_PER_KG;
  if (!run) {
    const [reactor] = await executor.insert(reactors).values({ organizationId: product.organizationId, facilityId: product.facilityId, code: `E2E-REACTOR-${randomUUID()}`, identifier: `E2E Reactor ${randomUUID()}`, reactorType: "auger" }).returning();
    ownedReactors.add(reactor.id);
    [run] = await executor.insert(productionRuns).values({ organizationId: product.organizationId, facilityId: product.facilityId, reactorId: reactor.id, biocharStorageLocationId: sourceStorageLocationId, code: `E2E-RUN-${randomUUID()}`, status: "complete", startTime: new Date(`${product.placedAt}T00:00:00Z`), endTime: new Date(`${product.placedAt}T01:00:00Z`), biocharDryMassKg: dryKg }).returning();
    ownedRuns.add(run.id);
  }
  await executor.insert(biocharProductSourceAllocations).values({ organizationId: product.organizationId, biocharProductId: product.id, productionRunId: run.id, sourceStorageLocationId, allocatedDryMassKg: dryKg, allocatedWetMassKg: product.massKg });
  await executor.update(biocharProducts).set({ sourceBiocharStorageLocationId: sourceStorageLocationId }).where(eq(biocharProducts.id, product.id));
  return { storageLocationId, formulationId: product.formulationId };
}

export async function ensureOutputFixtureActor(ctx: OrgContext) {
  await db.insert(users).values({ id: ctx.userId, email: `${ctx.userId}@e2e.local`, name: "E2E Fixture actor" }).onConflictDoNothing();
}
