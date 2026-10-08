import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  applications, samples, transportLegs, creditBatches, creditBatchProductionRuns, creditBatchApplications, productionProcesses, productionRunFeedstocks,
  biocharProducts,
  customerLocations,
  customers,
  deliveries,
  facilities,
  feedstockTypes,
  feedstocks,
  formulations,
  orders,
  organizations,
  productionRuns,
  reactors,
  storageLocations,
  supplierLocations,
  suppliers,
  users,
} from "@/db/schema";
import {
  createApplication,
  updateApplication, deleteApplication,
} from "@/data-access/applications";
import type { OrgContext } from "@/lib/auth/server";
import {
  STALE_VERSION_CONFLICT_CODE,
  STALE_VERSION_MESSAGE,
} from "@/lib/stale-version";
import {
  deleteOutputApplicationFixtures,
  deleteOutputDeliveryFixtures,
  deleteOutputFacilityFixtures,
  deleteOutputProductFixtures,
  insertOutputDeliveryFixture,
  outputOrderFixtureValues,
  outputProductFixtureValues,
} from "./helpers/output-contract-fixtures";

import { createCreditBatch, updateCreditBatch, deleteCreditBatch } from "@/data-access/credit-batches";
import { updateSample, deleteSample } from "@/data-access/samples";
import { updateOrder, deleteOrder } from "@/data-access/orders";
import { updateDelivery, deleteDelivery } from "@/data-access/delivery-output-writes";
import { createTransportLeg, updateTransportLeg, deleteTransportLeg, syncFeedstockTransportLeg } from "@/data-access/transport-legs";
import { archiveFacility, restoreFacility } from "@/data-access/facilities";
import { masterDataVersion } from "./helpers/master-data-version";
import { labLogisticsVersion } from "./helpers/lab-logistics-version";
const ORG_PREFIX = "e2e-expected-version-lab-logistics-org-";
const RUN_START = new Date("2025-06-15T08:00:00Z");
const RUN_END = new Date("2025-06-15T12:00:00Z");
const RUN_DRY_OUTPUT_KG = 1_000;
const ORDER_DATE = new Date("2025-07-01");
const DELIVERY_DATE = new Date("2025-07-05");
const APPLICATION_DATE = new Date("2025-07-08");
const ORDER_QUANTITY_KG = 10_000;
const DELIVERED_WET_KG = 5_000;
const DELIVERED_DRY_KG = 4_000;
const DELIVERY_MOISTURE_PERCENT = 20;
const APPLIED_TONS = 2;
const FIELD_SIZE_HA = 1;
const BIN_CAPACITY_KG = 10_000;
const INTAKE_WET_KG = 100;
const INTAKE_DRY_KG = 80;
const INTAKE_MOISTURE_PERCENT = 20;
const SAMPLE_TIER_EVIDENCE = {
  randomReflectanceR0Percent: 2.1,
  sReflectanceFraction: 0.92,
  residualCarbonPercent: 65,
};
const GPS = { lat: -3.3, lng: 37.3 } as const;

interface Fixture { tag: string; ctx: OrgContext; ids: Record<EntityKey, string>; facilityId: string }
type EntityKey = "sample" | "order" | "delivery" | "transportLeg" | "application" | "creditBatch";
const tables = { sample: "samples", order: "orders", delivery: "deliveries", transportLeg: "transportLegs", application: "applications", creditBatch: "creditBatches" } as const;
interface UpdaterCase {
  entity: EntityKey;
  save: (f: Fixture, expectedVersion: number, label: string) => Promise<{ version: number }>;
  remove: (f: Fixture, expectedVersion: number) => Promise<void>;
}
const UPDATERS: UpdaterCase[] = [
  { entity: "sample", save: (f, expectedVersion, label) => updateSample(f.ctx, f.ids.sample, { expectedVersion, labName: label }), remove: (f, v) => deleteSample(f.ctx, f.ids.sample, v) },
  { entity: "order", save: (f, expectedVersion, label) => updateOrder(f.ctx, f.ids.order, { expectedVersion, code: label }), remove: (f, v) => deleteOrder(f.ctx, f.ids.order, v) },
  { entity: "delivery", save: (f, expectedVersion, label) => updateDelivery(f.ctx, f.ids.delivery, { expectedVersion, code: label }), remove: (f, v) => deleteDelivery(f.ctx, f.ids.delivery, v) },
  { entity: "transportLeg", save: (f, expectedVersion, label) => updateTransportLeg(f.ctx, f.ids.transportLeg, { expectedVersion, originName: label }), remove: (f, v) => deleteTransportLeg(f.ctx, f.ids.transportLeg, v) },
  { entity: "application", save: (f, expectedVersion, label) => updateApplication(f.ctx, f.ids.application, { expectedVersion, fieldIdentifier: label }), remove: (f, v) => deleteApplication(f.ctx, f.ids.application, v) },
  { entity: "creditBatch", save: (f, expectedVersion, label) => updateCreditBatch(f.ctx, f.ids.creditBatch, { expectedVersion, siteManagementNotes: label }), remove: (f, v) => deleteCreditBatch(f.ctx, f.ids.creditBatch, v) },
];
const VERSION_INCREMENT = 1;
const TAG_LENGTH = 8;
const CASCADE_TRANSITIONS = 2;
const EXPECTED_COMMITS = 1;
async function seedFixture(): Promise<Fixture> {
  const tag = randomUUID().slice(0, TAG_LENGTH).toUpperCase();
  const organizationId = `${ORG_PREFIX}${tag}`;
  const userId = `e2e-expected-version-lab-logistics-user-${tag}`;
  const ctx: OrgContext = {
    organizationId,
    userId,
    orgRole: "owner",
    isPlatformAdmin: false,
  };

  const seeded = await db.transaction(async (tx) => {
    await tx.insert(organizations).values({
      id: organizationId,
      name: `E2E Lab logistics versions ${tag}`,
      slug: `e2e-expected-version-lab-logistics-${tag.toLowerCase()}`,
    });
    await tx.insert(users).values({
      id: userId,
      name: "E2E lab logistics versions operator",
      email: `expected-version-lab-logistics-${tag.toLowerCase()}@e2e.local`,
      emailVerified: true,
    });

    const [facility] = await tx
      .insert(facilities)
      .values({
        organizationId,
        code: `E2E-EXVB-F-${tag}`,
        name: `E2E Lab logistics versions ${tag}`,
        country: "Tanzania",
      })
      .returning({ id: facilities.id });

    const [feedstockType] = await tx
      .insert(feedstockTypes)
      .values({
        organizationId,
        code: `E2E-EXVB-T-${tag}`,
        name: `E2E Lab logistics versions type ${tag}`,
        category: "forestry",
        usage: "pyrolysis",
      })
      .returning({ id: feedstockTypes.id });

    const [bin] = await tx
      .insert(storageLocations)
      .values({
        organizationId,
        facilityId: facility.id,
        code: `E2E-EXVB-B-${tag}`,
        name: `E2E Lab logistics versions bin ${tag}`,
        type: "feedstock_bin",
        feedstockTypeId: feedstockType.id,
        capacityKg: BIN_CAPACITY_KG,
      })
      .returning({ id: storageLocations.id });

    const [feedstock] = await tx
      .insert(feedstocks)
      .values({
        organizationId,
        code: `E2E-EXVB-FS-${tag}`,
        facilityId: facility.id,
        status: "complete",
        feedstockTypeId: feedstockType.id,
        massDryKg: INTAKE_DRY_KG,
        massWetKg: INTAKE_WET_KG,
        moistureContentPercent: INTAKE_MOISTURE_PERCENT,
        storageLocationId: bin.id,
      })
      .returning({ id: feedstocks.id });

    const [customer] = await tx
      .insert(customers)
      .values({
        organizationId,
        code: `E2E-EXVB-CU-${tag}`,
        name: `E2E Lab logistics versions customer ${tag}`,
      })
      .returning({ id: customers.id });

    const [customerLocation] = await tx
      .insert(customerLocations)
      .values({
        organizationId,
        customerId: customer.id,
        name: `E2E Lab logistics versions field ${tag}`,
        country: "Tanzania",
        gpsLatitude: GPS.lat,
        gpsLongitude: GPS.lng,
      })
      .returning({ id: customerLocations.id });

    const [supplier] = await tx
      .insert(suppliers)
      .values({
        organizationId,
        code: `E2E-EXVB-SU-${tag}`,
        name: `E2E Lab logistics versions supplier ${tag}`,
      })
      .returning({ id: suppliers.id });

    const [supplierLocation] = await tx
      .insert(supplierLocations)
      .values({
        organizationId,
        supplierId: supplier.id,
        name: `E2E Lab logistics versions yard ${tag}`,
        country: "Tanzania",
        gpsLatitude: GPS.lat,
        gpsLongitude: GPS.lng,
        isDefault: true,
      })
      .returning({ id: supplierLocations.id });

    const [reactor] = await tx
      .insert(reactors)
      .values({
        organizationId,
        code: `E2E-EXVB-RE-${tag}`,
        facilityId: facility.id,
        identifier: `E2E Lab logistics versions reactor ${tag}`,
        reactorType: "fixed-bed",
      })
      .returning({ id: reactors.id });

    const [productionRun] = await tx
      .insert(productionRuns)
      .values({
        organizationId,
        code: `E2E-EXVB-PR-${tag}`,
        facilityId: facility.id,
        reactorId: reactor.id,
        startTime: RUN_START,
        endTime: RUN_END,
        biocharDryMassKg: RUN_DRY_OUTPUT_KG,
        status: "complete",
      })
      .returning({ id: productionRuns.id });

    await tx.insert(productionRunFeedstocks).values({ organizationId, productionRunId: productionRun.id, feedstockId: feedstock.id, wetMassUsedKg: INTAKE_WET_KG });

    const [formulation] = await tx
      .insert(formulations)
      .values({
        organizationId,
        code: `E2E-EXVB-FM-${tag}`,
        name: `E2E Lab logistics versions formulation ${tag}`,
      })
      .returning({ id: formulations.id });

    const [product] = await tx
      .insert(biocharProducts)
      .values(
        await outputProductFixtureValues(tx, {
          organizationId,
          code: `E2E-EXVB-BP-${tag}`,
          facilityId: facility.id,
          formulationId: formulation.id,
        }),
      )
      .returning({ id: biocharProducts.id });

    const [order] = await tx
      .insert(orders)
      .values(
        await outputOrderFixtureValues(tx, {
          organizationId,
          code: `E2E-EXVB-OR-${tag}`,
          facilityId: facility.id,
          biocharProductId: product.id,
          customerId: customer.id,
          customerLocationId: customerLocation.id,
          orderDate: ORDER_DATE,
          quantityKg: ORDER_QUANTITY_KG,
          packaging: "bagged",
        }),
      )
      .returning({ id: orders.id });

    const [delivery] = await insertOutputDeliveryFixture(
      tx,
      {
        organizationId,
        code: `E2E-EXVB-DL-${tag}`,
        facilityId: facility.id,
        orderId: order.id,
        status: "delivered",
        deliveryDate: DELIVERY_DATE,
        deliveredWetMassKg: DELIVERED_WET_KG,
        massDryKg: DELIVERED_DRY_KG,
        moistureContentPercent: DELIVERY_MOISTURE_PERCENT,
      },
      (row) => ({ id: row.id }),
    );

    return {
      facilityId: facility.id,
      feedstockId: feedstock.id,
      binId: bin.id,
      customerId: customer.id,
      customerLocationId: customerLocation.id,
      supplierId: supplier.id,
      supplierLocationId: supplierLocation.id,
      productionRunId: productionRun.id,
      deliveryId: delivery.id,
      orderId: order.id,
      feedstockTypeId: feedstockType.id,
    };
  });

  // The creator writes the application's source allocations, which the updater
  // re-validates; a raw insert would fail that check.
  const application = await createApplication(ctx, {
    code: `E2E-EXVB-AP-${tag}`,
    deliveryId: seeded.deliveryId,
    applicationDate: APPLICATION_DATE,
    biocharAppliedTons: APPLIED_TONS,
    fieldSizeHa: FIELD_SIZE_HA,
    gpsLatitude: GPS.lat,
    gpsLongitude: GPS.lng,
  });

  const batch = await createCreditBatch(ctx, {
    code: `E2E-LAB-CB-${tag}`, facilityId: seeded.facilityId,
    feedstockTypeId: seeded.feedstockTypeId, startDate: RUN_START, endDate: RUN_END,
    productionRunIds: [seeded.productionRunId], sampling: "sampled", currency: "TZS",
  });
  const [sample] = await db.insert(samples).values({ organizationId, creditBatchId: batch.id,
    productionRunId: seeded.productionRunId, sampleCode: `E2E-LAB-SP-${tag}`, samplingTime: RUN_END,
    totalCarbonPercent: 80, organicCarbonPercent: 75, inorganicCarbonPercent: 5,
    ...SAMPLE_TIER_EVIDENCE,
  }).returning();
  const leg = await createTransportLeg(ctx, { entityType: "sample", entityId: sample.id,
    distanceKm: 10, loadMassKg: 1, transportMethodType: "road", calculationMethodType: "distance_based",
  });
  const ids: Record<EntityKey, string> = {
    sample: sample.id, order: seeded.orderId, delivery: seeded.deliveryId,
    transportLeg: leg.id, application: application.id, creditBatch: batch.id,
  };

  return { tag, ctx, ids, facilityId: seeded.facilityId };
}

async function cleanup(fixture: Fixture): Promise<void> {
  const { organizationId, userId } = fixture.ctx;
  if (!organizationId.startsWith(ORG_PREFIX)) {
    throw new Error("Expected an isolated expected-version test organization");
  }
  await db.transaction(async (tx) => {
    await deleteOutputApplicationFixtures(
      tx,
      eq(applications.organizationId, organizationId),
    );
    await deleteOutputDeliveryFixtures(
      tx,
      eq(deliveries.organizationId, organizationId),
    );
    await tx.delete(transportLegs).where(eq(transportLegs.organizationId, organizationId));
    await tx.delete(samples).where(eq(samples.organizationId, organizationId));
    await tx.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.organizationId, organizationId));
    await tx.delete(creditBatchApplications).where(eq(creditBatchApplications.organizationId, organizationId));
    await tx.delete(creditBatches).where(eq(creditBatches.organizationId, organizationId));
    await tx.delete(productionProcesses).where(eq(productionProcesses.organizationId, organizationId));
    await tx.delete(orders).where(eq(orders.organizationId, organizationId));
    await deleteOutputProductFixtures(
      tx,
      eq(biocharProducts.organizationId, organizationId),
    );
    for (const table of [
      "bin_movements",
      "transport_legs",
      "production_run_feedstocks",
      "feedstocks",
      "production_runs",
      "reactors",
      "storage_locations",
      "formulations",
      "feedstock_types",
      "customer_locations",
      "customers",
      "supplier_locations",
      "suppliers",
    ]) {
      await tx.execute(
        sql`delete from ${sql.identifier(table)} where organization_id = ${organizationId}`,
      );
    }
    await deleteOutputFacilityFixtures(
      tx,
      eq(facilities.organizationId, organizationId),
    );
    await tx.delete(organizations).where(eq(organizations.id, organizationId));
    await tx.delete(users).where(eq(users.id, userId));
  });
}

const fixtures: Fixture[] = [];
async function fixture() { const f = await seedFixture(); fixtures.push(f); return f; }
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanup(f); });
const version = (f: Fixture, entity: EntityKey) => labLogisticsVersion(f.ctx, tables[entity], f.ids[entity]);
const stale = (f: Fixture, entity: EntityKey) => ({ code: "stale_version", message: STALE_VERSION_MESSAGE, conflict: { entity, id: f.ids[entity], code: STALE_VERSION_CONFLICT_CODE } });

describe.each(UPDATERS)("$entity integer versions", updater => {
  it("commits the current version and refuses stale update and delete", async () => {
    const f = await fixture(); const opened = await version(f, updater.entity);
    const saved = await updater.save(f, opened, `E2E-${f.tag}-FIRST`);
    expect(saved.version).toBe(opened + VERSION_INCREMENT);
    expect(await version(f, updater.entity)).toBe(saved.version);
    await expect(updater.save(f, opened, `E2E-${f.tag}-STALE`)).rejects.toMatchObject(stale(f, updater.entity));
    await expect(updater.remove(f, opened)).rejects.toMatchObject(stale(f, updater.entity));
    expect(await version(f, updater.entity)).toBe(saved.version);
    const next = await updater.save(f, saved.version, `E2E-${f.tag}-NEXT`);
    expect(next.version).toBe(saved.version + VERSION_INCREMENT);
  });
  it("commits exactly one of two writers with the same loaded version", async () => {
    const f = await fixture(); const opened = await version(f, updater.entity);
    const outcomes = await Promise.allSettled([updater.save(f, opened, `E2E-${f.tag}-A`), updater.save(f, opened, `E2E-${f.tag}-B`)]);
    const commits = outcomes.filter(o => o.status === "fulfilled");
    const refusals = outcomes.filter(o => o.status === "rejected");
    expect(commits).toHaveLength(EXPECTED_COMMITS);
    expect(refusals).toHaveLength(EXPECTED_COMMITS);
    expect(refusals[0].reason).toMatchObject(stale(f, updater.entity));
    expect(await version(f, updater.entity)).toBe(opened + VERSION_INCREMENT);
  });
});

it("facility archive and restore bump orders, deliveries and credit batches", async () => {
  const f = await fixture();
  const entities = ["order", "delivery", "creditBatch"] as const;
  const opened = await Promise.all(entities.map(e => version(f, e)));
  await archiveFacility(f.ctx, f.facilityId, await masterDataVersion(f.ctx, "facilities", f.facilityId));
  for (const [i, entity] of entities.entries()) expect(await version(f, entity)).toBe(opened[i] + VERSION_INCREMENT);
  await restoreFacility(f.ctx, f.facilityId, await masterDataVersion(f.ctx, "facilities", f.facilityId));
  for (const [i, entity] of entities.entries()) expect(await version(f, entity)).toBe(opened[i] + VERSION_INCREMENT * CASCADE_TRANSITIONS);
});
it("membership edits and batch deletion bump linked samples", async () => {
  const f = await fixture(); const opened = await version(f, "sample");
  const saved = await updateCreditBatch(f.ctx, f.ids.creditBatch, { expectedVersion: await version(f, "creditBatch"), productionRunIds: [] });
  expect(await version(f, "sample")).toBeGreaterThan(opened);
  const [sample] = await db.select().from(samples).where(eq(samples.id, f.ids.sample));
  expect(sample.creditBatchId).toBeNull();
  const relinked = await updateSample(f.ctx, sample.id, { expectedVersion: sample.version, creditBatchId: f.ids.creditBatch });
  await deleteCreditBatch(f.ctx, f.ids.creditBatch, saved.version);
  expect(await version(f, "sample")).toBe(relinked.version + VERSION_INCREMENT);
});
it("derived transport upserts bump the existing row", async () => {
  const f = await fixture();
  const [feedstock] = await db.select().from(feedstocks).where(eq(feedstocks.organizationId, f.ctx.organizationId));
  await db.transaction(tx => syncFeedstockTransportLeg(f.ctx, tx, feedstock.id, { distanceKm: 10 }));
  const [before] = await db.select().from(transportLegs).where(eq(transportLegs.entityId, feedstock.id));
  expect(before).toBeDefined();
  await db.transaction(tx => syncFeedstockTransportLeg(f.ctx, tx, feedstock.id, { distanceKm: 20 }));
  const [after] = await db.select().from(transportLegs).where(eq(transportLegs.id, before.id));
  expect(after.version).toBe(before.version + VERSION_INCREMENT);
});

it("delivery resync increments its derived product transport legs", async () => {
  const f = await fixture();
  const first = await updateDelivery(f.ctx, f.ids.delivery, { expectedVersion: await version(f, "delivery"), distanceKmOverride: 10, distanceSource: "manual" });
  const before = await db.select().from(transportLegs).where(eq(transportLegs.organizationId, f.ctx.organizationId));
  const derived = before.filter(row => row.entityType === "biochar" && row.isDerived);
  expect(derived.length).toBeGreaterThan(0);
  await updateDelivery(f.ctx, first.id, { expectedVersion: first.version, distanceKmOverride: 20, distanceSource: "manual" });
  for (const leg of derived) {
    const [after] = await db.select().from(transportLegs).where(eq(transportLegs.id, leg.id));
    expect(after.version).toBe(leg.version + VERSION_INCREMENT);
  }
});
