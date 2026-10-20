import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  applicationOutputAllocations, applications, biocharProducts, biocharProductSourceAllocations,
  binMovements, certifierRemovals, creditBatchApplications, creditBatchProductionRuns, creditBatches,
  customerLocations, customers, deliveries, facilities, feedstocks, feedstockTypes,
  formulations, orders, organizations, outputStockAllocations, outputStockRunAllocations,
  productionProcesses, productionRunFeedstocks, productionRuns, reactors, storageLocations, suppliers,
} from "@/db/schema";
import { getRecordCreditBatches } from "@/data-access/record-credit-batches";
import { inDeliveryCreditBatchLineage } from "@/data-access/credit-batch-lineage-filter";
import { PRO_RATA_POLICY } from "@/lib/output-stock";
import { feedstockFixtureValues } from "./helpers/feedstock-fixture";
import { insertRemovalFixture } from "./helpers/removal-fixture";
import {
  insertOutputApplicationFixture, insertOutputDeliveryFixture,
  outputOrderFixtureValues, outputProductFixtureValues,
} from "./helpers/output-contract-fixtures";
import { makeTestOrgContext, TEST_SITE_POSITION } from "./helpers/test-org";

const MASS_KG = 100;
const APPLIED_TONNES = 0.01;
const FIELD_SIZE_HA = 1;
const RUN_START = new Date("2025-01-01T08:00:00Z");
const RUN_END = new Date("2025-01-01T09:00:00Z");
const RUN_SPACING_MS = 2 * 60 * 60 * 1_000;
const RECORD_DATE = new Date("2026-06-01T12:00:00Z");
const EARLY_WINDOW = { startDate: "2025-01-01", endDate: "2025-01-15" };
const LATE_WINDOW = { startDate: "2025-01-16", endDate: "2025-01-31" };
const KINDS = ["feedstock", "delivery", "application"] as const;

describe("saved record credit batches (real database)", () => {
  const organizationId = `org_record_batches_${randomUUID()}`;
  const ctx = { ...makeTestOrgContext(), organizationId };
  const otherOrgId = `org_record_batches_other_${randomUUID()}`;
  const otherCtx = { ...ctx, organizationId: otherOrgId };
  const org = { organizationId };

  beforeAll(async () => {
    await db.insert(organizations).values([organizationId, otherOrgId].map(id => ({
      id, name: "E2E Record batches", slug: id,
    })));
  });

  afterAll(async () => {
    // Every row belongs to this suite's private organization, including helper parents.
    for (const table of [
      creditBatchApplications, certifierRemovals, applicationOutputAllocations, applications,
      outputStockRunAllocations, outputStockAllocations, binMovements, deliveries, orders,
      biocharProductSourceAllocations, biocharProducts, creditBatchProductionRuns,
      productionRunFeedstocks, productionRuns, creditBatches, productionProcesses,
      feedstocks, storageLocations, reactors, facilities, feedstockTypes,
      formulations, customerLocations, customers, suppliers,
    ]) {
      await db.delete(table).where(eq(table.organizationId, organizationId));
    }
    await db.delete(organizations).where(eq(organizations.id, organizationId));
    await db.delete(organizations).where(eq(organizations.id, otherOrgId));
  });

  async function fixture() {
    const tag = randomUUID();
    const [facility] = await db.insert(facilities).values({
      ...org, ...TEST_SITE_POSITION, timezone: "UTC", code: `FAC-${tag}`, name: `E2E Facility ${tag}`,
    }).returning();
    const [type] = await db.insert(feedstockTypes).values({
      ...org, code: `FT-${tag}`, name: `E2E Feedstock ${tag}`, category: "forestry", usage: "pyrolysis",
    }).returning();
    const [process] = await db.insert(productionProcesses).values({
      ...org, facilityId: facility.id, feedstockTypeId: type.id, establishedAt: RUN_START,
    }).returning();
    const [reactor] = await db.insert(reactors).values({
      ...org, facilityId: facility.id, code: `RE-${tag}`, identifier: `E2E Reactor ${tag}`, reactorType: "auger",
    }).returning();
    const [outputBin] = await db.insert(storageLocations).values({
      ...org, facilityId: facility.id, type: "biochar_bin", code: `OUT-${tag}`, name: `E2E Output ${tag}`,
    }).returning();
    const [feedstock] = await db.insert(feedstocks).values(await feedstockFixtureValues(db, {
      ...org, facilityId: facility.id, feedstockTypeId: type.id, code: `FS-${tag}`,
      massDryKg: MASS_KG, deliveryDate: RECORD_DATE,
    })).returning();
    const [emptyFeedstock] = await db.insert(feedstocks).values(await feedstockFixtureValues(db, {
      ...org, facilityId: facility.id, feedstockTypeId: type.id, code: `FS-EMPTY-${tag}`,
      storageLocationId: feedstock.storageLocationId, supplierId: feedstock.supplierId,
      massDryKg: MASS_KG, deliveryDate: RECORD_DATE,
    })).returning();
    // Insert in reverse order. Dates, rather than insertion or code order, decide the result.
    const [late, early] = await db.insert(creditBatches).values([
      { ...LATE_WINDOW, code: `CB-A-${tag}` }, { ...EARLY_WINDOW, code: `CB-Z-${tag}` },
    ].map(values => ({
      ...org, ...values, facilityId: facility.id, feedstockTypeId: type.id, productionProcessId: process.id,
    }))).returning();
    const runs = await db.insert(productionRuns).values(["A", "B", "C"].map((label, index) => ({
      ...org, facilityId: facility.id, reactorId: reactor.id, code: `PR-${label}-${tag}`,
      status: "complete" as const,
      startTime: new Date(RUN_START.getTime() + index * RUN_SPACING_MS),
      endTime: new Date(RUN_END.getTime() + index * RUN_SPACING_MS),
      biocharStorageLocationId: outputBin.id, biocharOutputKg: MASS_KG,
      biocharDryMassKg: MASS_KG, biocharMoisturePercent: 0,
    }))).returning();
    const [runA, runB, runC] = runs;
    await db.insert(productionRunFeedstocks).values(runs.map(run => ({
      ...org, productionRunId: run.id, feedstockId: feedstock.id, wetMassUsedKg: MASS_KG,
    })));
    await db.insert(creditBatchProductionRuns).values([
      { ...org, productionRunId: runA.id, creditBatchId: early.id },
      { ...org, productionRunId: runB.id, creditBatchId: late.id },
      { ...org, productionRunId: runC.id, creditBatchId: early.id },
    ]);
    const [product] = await db.insert(biocharProducts).values(await outputProductFixtureValues(db, {
      ...org, facilityId: facility.id, code: `BP-${tag}`,
      linkedProductionRunId: runA.id, placedAt: RUN_END,
    })).returning();
    await db.insert(biocharProductSourceAllocations).values(runs.map(run => ({
      ...org, biocharProductId: product.id, productionRunId: run.id,
      sourceStorageLocationId: outputBin.id, allocatedDryMassKg: MASS_KG, allocatedWetMassKg: MASS_KG,
    })));
    const [customer] = await db.insert(customers).values({
      ...org, code: `CU-${tag}`, name: `E2E Customer ${tag}`,
    }).returning();
    const [order] = await db.insert(orders).values(await outputOrderFixtureValues(db, {
      ...org, facilityId: facility.id, customerId: customer.id, biocharProductId: product.id,
      code: `OR-${tag}`, orderDate: RECORD_DATE, quantityKg: MASS_KG, packaging: "loose",
    })).returning();
    const [delivery] = await insertOutputDeliveryFixture(db, {
      ...org, facilityId: facility.id, orderId: order.id, code: `DL-${tag}`,
      deliveryDate: RECORD_DATE, deliveredWetMassKg: MASS_KG, massDryKg: MASS_KG,
    }, row => row);
    // A saved delivery without measured dry provenance has no source allocations.
    const [emptyDelivery] = await insertOutputDeliveryFixture(db, {
      ...org, facilityId: facility.id, orderId: order.id, code: `DL-EMPTY-${tag}`,
      deliveryDate: RECORD_DATE, deliveredWetMassKg: MASS_KG, massDryKg: null,
    }, row => row);
    const [application, emptyApplication] = await insertOutputApplicationFixture(db,
      [delivery, emptyDelivery].map(source => ({
        ...org, deliveryId: source.id, code: `AP-${source.id}`, applicationDate: RECORD_DATE,
        biocharAppliedTons: APPLIED_TONNES, biocharAppliedDryTons: APPLIED_TONNES, fieldSizeHa: FIELD_SIZE_HA,
      })), row => row);
    return {
      ids: { feedstock: feedstock.id, delivery: delivery.id, application: application.id },
      emptyIds: { feedstock: emptyFeedstock.id, delivery: emptyDelivery.id, application: emptyApplication.id },
      early, late, product, delivery, application, runs, runB,
    };
  }

  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function batch(row: Fixture["early"]) {
    return { id: row.id, code: row.code, startDate: row.startDate, endDate: row.endDate };
  }

  it.each(KINDS)("%s returns every distinct batch in date order, independent of record date", async kind => {
    const f = await fixture();
    expect(await getRecordCreditBatches(ctx, { kind, id: f.ids[kind] }))
      .toEqual({ batches: [batch(f.early), batch(f.late)], heldOut: false });
  });

  it.each(KINDS)("%s returns none without provenance, even in a shared source bin", async kind => {
    const f = await fixture();
    expect(await getRecordCreditBatches(ctx, { kind, id: f.emptyIds[kind] })).toEqual({ batches: [], heldOut: false });
  });

  it.each(KINDS)("%s hides another organization's ID exactly like a missing ID", async kind => {
    const f = await fixture();
    await expect(getRecordCreditBatches(otherCtx, { kind, id: f.ids[kind] })).rejects.toThrow(/not found in this organization/i);
    await expect(getRecordCreditBatches(ctx, { kind, id: randomUUID() })).rejects.toThrow(/not found in this organization/i);
  });

  it("requires an organization scope", async () => {
    await expect(getRecordCreditBatches({ ...ctx, organizationId: "" }, {
      kind: "feedstock", id: randomUUID(),
    })).rejects.toThrow("Unauthorized");
  });

  it("uses code as the tie-breaker when batch start dates match", async () => {
    const f = await fixture();
    await db.update(creditBatches).set(EARLY_WINDOW).where(eq(creditBatches.id, f.late.id));
    expect((await getRecordCreditBatches(ctx, { kind: "feedstock", id: f.ids.feedstock })).batches.map(b => b.id))
      .toEqual([f.late.id, f.early.id]);
  });

  it("unions saved application slices with positive source-run memberships and deduplicates batches", async () => {
    const f = await fixture();
    // Keep only batch B's share, so batch A can only be reached through its slice.
    await db.delete(applicationOutputAllocations).where(and(
      eq(applicationOutputAllocations.organizationId, organizationId),
      eq(applicationOutputAllocations.applicationId, f.application.id),
      ne(applicationOutputAllocations.productionRunId, f.runB.id),
    ));
    await db.insert(creditBatchApplications).values({
      ...org, applicationId: f.application.id, creditBatchId: f.early.id,
      allocatedWetMassKg: MASS_KG, allocatedDryMassKg: MASS_KG,
    });
    expect(await getRecordCreditBatches(ctx, { kind: "application", id: f.application.id }))
      .toEqual({ batches: [batch(f.early), batch(f.late)], heldOut: false });
    await db.insert(creditBatchApplications).values({
      ...org, applicationId: f.application.id, creditBatchId: f.late.id,
      allocatedWetMassKg: MASS_KG, allocatedDryMassKg: MASS_KG,
    });
    expect(await getRecordCreditBatches(ctx, { kind: "application", id: f.application.id }))
      .toEqual({ batches: [batch(f.early), batch(f.late)], heldOut: false });
  });

  it("ignores zero application shares but keeps a wet-only positive share", async () => {
    const f = await fixture();
    const predicate = and(eq(applicationOutputAllocations.applicationId, f.application.id),
      eq(applicationOutputAllocations.productionRunId, f.runB.id));
    await db.update(applicationOutputAllocations).set({ wetMassKg: "0", dryMassKg: "0" }).where(predicate);
    expect((await getRecordCreditBatches(ctx, { kind: "application", id: f.application.id })).batches)
      .toEqual([batch(f.early)]);
    await db.update(applicationOutputAllocations).set({ wetMassKg: "1" }).where(predicate);
    expect((await getRecordCreditBatches(ctx, { kind: "application", id: f.application.id })).batches)
      .toEqual([batch(f.early), batch(f.late)]);
  });

  async function reverseDelivery(f: Fixture, policy?: string) {
    const [original] = await db.select().from(outputStockAllocations)
      .where(eq(outputStockAllocations.deliveryId, f.delivery.id));
    if (policy) await db.update(outputStockAllocations).set({ basisSnapshot: { policy } })
      .where(eq(outputStockAllocations.id, original.id));
    const [movement] = await db.insert(binMovements).values({
      ...org, storageLocationId: f.delivery.storageLocationId, lane: "product",
      movementType: "adjustment", massDeltaKg: MASS_KG, reason: "E2E correction",
      outputKind: "reversal", occurredAt: RECORD_DATE, idempotencyKey: randomUUID(),
      basisFingerprint: "fixture-reversal", inputSnapshot: {}, outputDryDeltaKg: String(MASS_KG),
      balanceBeforeDryKg: "0", balanceAfterDryKg: String(MASS_KG), correctsMovementId: original.movementId,
    }).returning();
    const [reversal] = await db.insert(outputStockAllocations).values({
      ...org, movementId: movement.id, sourceStorageLocationId: original.sourceStorageLocationId,
      biocharProductId: original.biocharProductId, deliveryId: f.delivery.id,
      reversesAllocationId: original.id, dryMassKg: String(-MASS_KG), wetMassKg: String(-MASS_KG),
      basisSnapshot: policy ? { policy } : original.basisSnapshot,
    }).returning();
    const shares = await db.select().from(outputStockRunAllocations)
      .where(eq(outputStockRunAllocations.allocationId, original.id));
    await db.insert(outputStockRunAllocations).values(shares.map(share => ({
      ...org, allocationId: reversal.id, productionRunId: share.productionRunId,
      dryMassKg: String(-Number(share.dryMassKg)),
    })));
    return original;
  }

  it("excludes runs with zero net delivery dry mass, agreeing with the existing lineage filter", async () => {
    const f = await fixture();
    const original = await reverseDelivery(f);
    expect(await getRecordCreditBatches(ctx, { kind: "delivery", id: f.delivery.id })).toEqual({ batches: [], heldOut: false });

    // A replacement draws only the first run; the other runs still net to zero.
    const [movement] = await db.insert(binMovements).values({
      ...org, storageLocationId: f.delivery.storageLocationId, lane: "product",
      movementType: "adjustment", massDeltaKg: -MASS_KG, reason: "E2E replacement",
      outputKind: "replacement", occurredAt: RECORD_DATE, idempotencyKey: randomUUID(),
      basisFingerprint: "fixture-replacement", inputSnapshot: {}, outputDryDeltaKg: String(-MASS_KG),
      balanceBeforeDryKg: String(MASS_KG), balanceAfterDryKg: "0", correctsMovementId: original.movementId,
    }).returning();
    const [replacement] = await db.insert(outputStockAllocations).values({
      ...org, movementId: movement.id, sourceStorageLocationId: original.sourceStorageLocationId,
      biocharProductId: original.biocharProductId, deliveryId: f.delivery.id,
      dryMassKg: String(MASS_KG), wetMassKg: String(MASS_KG), basisSnapshot: {},
    }).returning();
    await db.insert(outputStockRunAllocations).values({
      ...org, allocationId: replacement.id, productionRunId: f.runs[0].id, dryMassKg: String(MASS_KG),
    });
    expect(await getRecordCreditBatches(ctx, { kind: "delivery", id: f.delivery.id }))
      .toEqual({ batches: [batch(f.early)], heldOut: false });
    for (const target of [f.early, f.late]) {
      const matching = await db.select({ id: deliveries.id }).from(deliveries).where(and(
        eq(deliveries.organizationId, organizationId), eq(deliveries.id, f.delivery.id),
        inDeliveryCreditBatchLineage(ctx, target.id, deliveries.id),
      ));
      expect(matching).toEqual(target.id === f.early.id ? [{ id: f.delivery.id }] : []);
    }
  });

  it("rejects delivery allocation provenance from a different source bin", async () => {
    const f = await fixture();
    await db.update(outputStockAllocations).set({
      sourceStorageLocationId: f.product.sourceBiocharStorageLocationId,
    }).where(eq(outputStockAllocations.deliveryId, f.delivery.id));
    expect(await getRecordCreditBatches(ctx, { kind: "delivery", id: f.delivery.id })).toEqual({ batches: [], heldOut: false });
  });

  it("holds out a mix-bin application with only unowned slices, and releases a reversed mix draw", async () => {
    const f = await fixture();
    await db.update(outputStockAllocations).set({ basisSnapshot: { policy: PRO_RATA_POLICY } })
      .where(eq(outputStockAllocations.deliveryId, f.delivery.id));
    expect(await getRecordCreditBatches(ctx, { kind: "application", id: f.application.id })).toEqual({ batches: [], heldOut: true });
    await db.insert(creditBatchApplications).values({
      ...org, applicationId: f.application.id, creditBatchId: f.early.id,
      allocatedWetMassKg: MASS_KG, allocatedDryMassKg: MASS_KG,
    });
    expect(await getRecordCreditBatches(ctx, { kind: "application", id: f.application.id })).toEqual({ batches: [], heldOut: true });
    await reverseDelivery(f, PRO_RATA_POLICY);
    expect(await getRecordCreditBatches(ctx, { kind: "application", id: f.application.id }))
      .toEqual({ batches: [batch(f.early), batch(f.late)], heldOut: false });
  });

  it("returns only Removal-owned slices for a held-out application with heldOut false", async () => {
    const f = await fixture();
    await db.update(outputStockAllocations).set({ basisSnapshot: { policy: PRO_RATA_POLICY } })
      .where(and(
        eq(outputStockAllocations.organizationId, organizationId),
        eq(outputStockAllocations.deliveryId, f.delivery.id),
      ));
    const [removal] = await insertRemovalFixture(db, {
      ...org, facilityId: f.early.facilityId,
    });
    await db.insert(creditBatchApplications).values([f.early, f.late].map(target => ({
      ...org, applicationId: f.application.id, creditBatchId: target.id,
      allocatedWetMassKg: MASS_KG, allocatedDryMassKg: MASS_KG,
    })));
    await db.update(creditBatchApplications).set({ removalId: removal.id }).where(and(
      eq(creditBatchApplications.organizationId, organizationId),
      eq(creditBatchApplications.applicationId, f.application.id),
      eq(creditBatchApplications.creditBatchId, f.early.id),
    ));
    // Batch B has both an unowned slice and a positive share, neither of which is credited.
    expect(await getRecordCreditBatches(ctx, { kind: "application", id: f.application.id }))
      .toEqual({ batches: [batch(f.early)], heldOut: false });
  });
});
