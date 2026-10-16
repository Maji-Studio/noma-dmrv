import { updateCustomerLocation } from "@/data-access/customers";
import { customerLocations, customerLocationFacilityDistances, certificationSubmissions } from "@/db/schema";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { applicationOutputAllocations, applications, biocharProducts, creditBatchApplications, deliveries, orders, productionRuns, transportLegs } from "@/db/schema";
import { buildMassAccounting } from "@/lib/certification/mass-accounting";
import { tonnesToKg } from "@/lib/calculations/unit-conversions";
import { resolveScopeForRemoval } from "@/fn/certification/certify-context-core";
import { loadTransportLegsByCategory } from "@/fn/certification/shared";
import { updateTransportLeg } from "@/data-access/transport-legs";
import { createApplication } from "@/data-access/applications";
import { previewOutputStock } from "@/data-access/output-stock-operations";
import { aggregateBiocharTransportMassDistance } from "@/lib/isometric/utils/aggregation";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { deleteOutputApplicationFixtures, deleteOutputDeliveryFixtures, deleteOutputProductFixtures, ensureOutputFixtureActor, outputProductFixtureValues, preparePureOutputProductFixture } from "./helpers/output-contract-fixtures";
import { createDelivery } from "./helpers/create-delivery";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const ctx = makeTestOrgContext();
const HALF_WET_KG = 100;
const HALF_DRY_KG = 95;
const DISTANCE_KM = 10;
const EXPECTED_TONNE_KM = 4;
const PRODUCT_WET_KG = 600;
const PRODUCT_DRY_KG = 570;
const MOISTURE_PERCENT = 5;
const LATER_DISTANCE_KM = 100;
const EDITED_APPLIED_TONS = 0.05;

beforeAll(async () => { await ensureTestOrg(); await ensureOutputFixtureActor(ctx); });

describe("Removal delivery transport", () => {
  it.each([
    { blockingVia: "removal", status: "submitted" },
    { blockingVia: "removal", status: "accepted" },
    { blockingVia: "ghgStatement", status: "submitted" },
  ] as const)("freezes location and pair edits under $status $blockingVia", async ({ blockingVia, status }) => {
    await withLineageFixture(async fixture => {
      await db.update(certificationSubmissions).set({ status }).where(and(
        eq(certificationSubmissions.organizationId, TEST_ORG_ID),
        eq(certificationSubmissions.localEntityId, fixture.ghgStatementId ?? fixture.removalId),
      ));
      const [order] = await db.select().from(orders).where(eq(orders.id, fixture.orderId));
      const [location] = await db.select().from(customerLocations).where(eq(customerLocations.id, order.customerLocationId));
      await db.insert(customerLocationFacilityDistances).values({ organizationId: TEST_ORG_ID, locationId: location.id, facilityId: fixture.facilityId, distanceKm: DISTANCE_KM, distanceSource: "manual" });
      await db.update(deliveries).set({ distanceKmOverride: null, recordedDistanceKm: DISTANCE_KM, recordedDistanceSource: "manual" }).where(eq(deliveries.id, fixture.deliveryId));
      const readTransport = async () => {
        const scope = await resolveScopeForRemoval(ctx, fixture.removalId);
        return loadTransportLegsByCategory(ctx, { feedstockIds: [], biocharProductIds: [fixture.productId], sampleIds: [] }, scope.lineages, ["biochar"]);
      };
      const before = await readTransport();
      const edited = await updateCustomerLocation(ctx, location.id, { expectedVersion: location.version, name: "E2E renamed locked route" });
      await updateCustomerLocation(ctx, location.id, { expectedVersion: edited.version, facilityDistances: [{ facilityId: fixture.facilityId, distanceKm: LATER_DISTANCE_KM, distanceSource: "map_estimate" }] });
      const after = await readTransport();
      expect(after.biochar.map(leg => ({ distanceKm: leg.distanceKm, distanceSource: leg.distanceSource, loadMassKg: leg.loadMassKg })))
        .toEqual(before.biochar.map(leg => ({ distanceKm: leg.distanceKm, distanceSource: leg.distanceSource, loadMassKg: leg.loadMassKg })));
      expect(aggregateBiocharTransportMassDistance(after.biochar).massDistanceTonneKm).toBe(EXPECTED_TONNE_KM);
    }, blockingVia);
  });

  it("keeps both frozen product slices from one application and source run", async () => {
    await withLineageFixture(async (fixture) => {
      const [product] = await db.insert(biocharProducts).values(await outputProductFixtureValues(db, {
        organizationId: TEST_ORG_ID,
        facilityId: fixture.facilityId,
        code: `BP-TRANSPORT-${crypto.randomUUID()}`,
        linkedProductionRunId: fixture.productionRunId,
        massKg: HALF_WET_KG,
        moistureContentPercent: 5,
      })).returning();
      try {
        await db.update(applicationOutputAllocations)
          .set({ wetMassKg: String(HALF_WET_KG), dryMassKg: String(HALF_DRY_KG) })
          .where(eq(applicationOutputAllocations.applicationId, fixture.applicationId));
        await db.insert(applicationOutputAllocations).values({
          organizationId: TEST_ORG_ID,
          applicationId: fixture.applicationId,
          deliveryId: fixture.deliveryId,
          biocharProductId: product.id,
          productionRunId: fixture.productionRunId,
          wetMassKg: String(HALF_WET_KG),
          dryMassKg: String(HALF_DRY_KG),
        });
        await db.update(deliveries).set({ distanceKmOverride: DISTANCE_KM })
          .where(eq(deliveries.id, fixture.deliveryId));

        const scope = await resolveScopeForRemoval(ctx, fixture.removalId);
        expect(scope.lineages).toHaveLength(2);
        expect(scope.lineages.map(lineage => lineage.biocharProduct?.id).sort())
          .toEqual([fixture.productId, product.id].sort());
        expect(scope.lineages.map(lineage => lineage.application.biocharAppliedTons))
          .toEqual([0.1, 0.1]);
        const sourceRun = scope.lineages[0].productionRun!;
        const accounting = buildMassAccounting(scope.lineages, [sourceRun]);
        const expectedAppliedDryKg = HALF_DRY_KG * 2;
        expect(accounting.runSummary.appliedDryKg).toBe(expectedAppliedDryKg);
        expect(accounting.attributionByRunId.get(fixture.productionRunId))
          .toBeCloseTo(expectedAppliedDryKg / sourceRun.biocharDryMassKg!);
        expect(accounting.runSummary.appliedDryKg).toBe(tonnesToKg(
          scope.memberBatches.reduce((total, batch) => total + batch.appliedDryWeightTons, 0),
        ));
        const legs = await loadTransportLegsByCategory(ctx, {
          feedstockIds: [], biocharProductIds: [fixture.productId, product.id], sampleIds: [],
        }, scope.lineages, ["biochar"]);
        expect(legs.biochar).toHaveLength(1);
        expect(legs.biochar[0].loadMassKg).toBe(HALF_WET_KG * 2);
        expect(aggregateBiocharTransportMassDistance(legs.biochar).massDistanceTonneKm)
          .toBe(EXPECTED_TONNE_KM);
      } finally {
        await db.delete(applicationOutputAllocations).where(eq(applicationOutputAllocations.biocharProductId, product.id));
        await deleteOutputProductFixtures(db, eq(biocharProducts.id, product.id));
      }
    });
  });

  it("keeps Removal tonne-km frozen after a later delivery, application and live mass edit", async () => {
    await withLineageFixture(async (fixture) => {
      // Leave stock for a later posting while retaining the original owned slice.
      await db.update(productionRuns).set({
        status: "complete", endTime: new Date("2026-06-13T12:00:00Z"),
        biocharOutputKg: PRODUCT_WET_KG, biocharDryMassKg: PRODUCT_DRY_KG,
      }).where(eq(productionRuns.id, fixture.productionRunId));
      await db.update(biocharProducts).set({
        massKg: PRODUCT_WET_KG, placedAt: new Date("2026-06-13T13:00:00Z"),
      }).where(eq(biocharProducts.id, fixture.productId));
      await db.update(orders).set({ quantityKg: PRODUCT_WET_KG })
        .where(eq(orders.id, fixture.orderId));
      await db.update(deliveries).set({ distanceKmOverride: DISTANCE_KM })
        .where(eq(deliveries.id, fixture.deliveryId));
      const { storageLocationId } = await preparePureOutputProductFixture(db, fixture.productId);
      const removalTransport = async () => {
        const scope = await resolveScopeForRemoval(ctx, fixture.removalId);
        expect(scope.lineages.map(lineage => lineage.application.id)).toEqual([fixture.applicationId]);
        const legs = await loadTransportLegsByCategory(ctx, {
          feedstockIds: [], biocharProductIds: [fixture.productId], sampleIds: [],
        }, scope.lineages, ["biochar"]);
        return aggregateBiocharTransportMassDistance(legs.biochar).massDistanceTonneKm;
      };
      const before = await removalTransport();
      expect(before).toBe(EXPECTED_TONNE_KM);
      const idempotencyKey = crypto.randomUUID();
      try {
        const deliveredAt = new Date("2026-06-18T12:00:00Z");
        const preview = await previewOutputStock(ctx, {
          kind: "delivery", facilityId: fixture.facilityId, storageLocationId,
          occurredAt: deliveredAt.toISOString(), wetMassKg: HALF_WET_KG,
          moisturePercent: MOISTURE_PERCENT,
        });
        const laterDelivery = await createDelivery(ctx, {
          orderId: fixture.orderId, facilityId: fixture.facilityId, storageLocationId,
          code: `DL-FROZEN-${idempotencyKey.toUpperCase()}`, deliveryDate: deliveredAt,
          deliveredWetMassKg: HALF_WET_KG, moistureContentPercent: MOISTURE_PERCENT,
          distanceKmOverride: LATER_DISTANCE_KM, basisFingerprint: preview.basisFingerprint,
          idempotencyKey,
        });
        let laterApplicationId: string | null = null;
        try {
          const laterApplication = await createApplication(ctx, {
            code: `AP-FROZEN-${crypto.randomUUID().toUpperCase()}`, deliveryId: laterDelivery.id,
            applicationDate: new Date("2026-06-19T12:00:00Z"),
            biocharAppliedTons: 0.1, fieldSizeHa: 1,
          });
          laterApplicationId = laterApplication.id;
          const [laterSlice] = await db.select().from(creditBatchApplications)
            .where(eq(creditBatchApplications.applicationId, laterApplication.id));
          expect(laterSlice).toMatchObject({
            creditBatchId: fixture.batchId, removalId: null, allocatedWetMassKg: HALF_WET_KG,
          });
          expect(await removalTransport()).toBe(before);

          // Simulate live-row drift without changing the owned allocation snapshot.
          await db.update(applications).set({ biocharAppliedTons: EDITED_APPLIED_TONS })
            .where(eq(applications.id, fixture.applicationId));
          expect(await removalTransport()).toBe(before);
        } finally {
          if (laterApplicationId) {
            await db.delete(creditBatchApplications)
              .where(eq(creditBatchApplications.applicationId, laterApplicationId));
          }
          await deleteOutputApplicationFixtures(db, eq(applications.deliveryId, laterDelivery.id));
          await deleteOutputDeliveryFixtures(db, eq(deliveries.id, laterDelivery.id));
        }
      } finally {
        await db.delete(transportLegs).where(eq(transportLegs.entityId, fixture.productId));
      }
    }, "none");
  });

  it("rejects direct edits to a saved biochar leg", async () => {
    await withLineageFixture(async (fixture) => {
      const [leg] = await db.insert(transportLegs).values({
        organizationId: TEST_ORG_ID, entityType: "biochar", entityId: fixture.productId,
        distanceKm: DISTANCE_KM, loadMassKg: HALF_WET_KG,
        transportMethodType: "road", calculationMethodType: "distance_based",
      }).returning();
      await expect(updateTransportLeg(ctx, leg.id, {
        expectedVersion: leg.version, distanceKm: DISTANCE_KM * 2,
      })).rejects.toThrow("Biochar transport is derived from deliveries");
      const [saved] = await db.select().from(transportLegs).where(eq(transportLegs.id, leg.id));
      expect(saved.distanceKm).toBe(DISTANCE_KM);
    }, "none");
  });
});
