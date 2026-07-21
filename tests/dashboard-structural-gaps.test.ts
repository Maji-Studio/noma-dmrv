/**
 * DB-backed regression coverage for the dashboard's structural certification
 * gaps. The fixture exercises canonical supplier-origin GPS, all three parent
 * types that own transport legs, and strict sample parent precedence.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  biocharProducts,
  creditBatches,
  facilities,
  feedstocks,
  feedstockTypes,
  organizations,
  productionProcesses,
  productionRuns,
  reactors,
  samples,
  supplierLocations,
  suppliers,
  transportLegs,
} from "@/db/schema";
import {
  buildDashboardStructuralGaps,
  loadDashboardStructuralGapCounts,
} from "@/data-access/dashboard-structural-gaps";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const TEST_USER_ID = "test-user-dashboard-structural-gaps";
const COMPLETE_ENDPOINTS = {
  originGpsLatitude: -6.8,
  originGpsLongitude: 39.28,
  destinationGpsLatitude: -6.16,
  destinationGpsLongitude: 35.75,
};
const SAMPLE_CHEMISTRY = {
  totalCarbonPercent: 80,
  organicCarbonPercent: 75,
};

interface Fixture {
  gapFacilityId: string;
  clearFacilityId: string;
  excludedFacilityId: string;
  missingGpsSupplierId: string;
  activeBiocharProductId: string;
  validBatchSampleId: string;
  activeFeedstockId: string;
  ids: {
    facilities: string[];
    suppliers: string[];
    supplierLocations: string[];
    feedstocks: string[];
    feedstockTypes: string[];
    reactors: string[];
    productionRuns: string[];
    productionProcesses: string[];
    creditBatches: string[];
    samples: string[];
    biocharProducts: string[];
    transportLegs: string[];
  };
  foreignOrgId: string;
}

let dbReachable = true;
let fixture: Fixture | null = null;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
  } catch {
    dbReachable = false;
    return;
  }

  await ensureTestOrg();
  const tag = crypto.randomUUID().slice(0, 8);
  fixture = await db.transaction(async (tx) => {
    const foreignOrgId = `org-dashboard-gap-${tag}`;
    await tx.insert(organizations).values({
      id: foreignOrgId,
      name: `Dashboard gap foreign ${tag}`,
      slug: `dashboard-gap-foreign-${tag}`,
    });

    const facilityRows = await tx
      .insert(facilities)
      .values([
        {
          organizationId: TEST_ORG_ID,
          code: `FAC-DG-GAP-${tag}`,
          name: `Dashboard gap ${tag}`,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `FAC-DG-CLEAR-${tag}`,
          name: `Dashboard clear ${tag}`,
          gpsLatitude: -6.16,
          gpsLongitude: 35.75,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `FAC-DG-OTHER-${tag}`,
          name: `Dashboard other ${tag}`,
          gpsLatitude: -6.17,
          gpsLongitude: 35.76,
        },
      ])
      .returning({ id: facilities.id });
    const [gapFacility, clearFacility, excludedFacility] = facilityRows;

    const [feedstockType] = await tx
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-DG-${tag}`,
        name: `Dashboard gap feedstock ${tag}`,
        category: "forestry",
      })
      .returning({ id: feedstockTypes.id });

    const supplierRows = await tx
      .insert(suppliers)
      .values([
        {
          organizationId: TEST_ORG_ID,
          code: `SUP-DG-MISSING-${tag}`,
          name: `Dashboard missing GPS ${tag}`,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `SUP-DG-FALLBACK-${tag}`,
          name: `Dashboard supplier fallback ${tag}`,
          gpsLatitude: -6.81,
          gpsLongitude: 39.29,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `SUP-DG-LOCATION-${tag}`,
          name: `Dashboard location precedence ${tag}`,
        },
      ])
      .returning({ id: suppliers.id });
    const [missingGpsSupplier, fallbackSupplier, locationSupplier] = supplierRows;

    const supplierLocationRows = await tx
      .insert(supplierLocations)
      .values([
        {
          organizationId: TEST_ORG_ID,
          supplierId: missingGpsSupplier.id,
          name: "Incomplete default",
          country: "TZ",
          gpsLatitude: -6.82,
          isDefault: true,
        },
        {
          organizationId: TEST_ORG_ID,
          supplierId: fallbackSupplier.id,
          name: "Incomplete location falls back as a pair",
          country: "TZ",
          gpsLongitude: 39.3,
          isDefault: true,
        },
        {
          organizationId: TEST_ORG_ID,
          supplierId: locationSupplier.id,
          name: "Complete default wins",
          country: "TZ",
          gpsLatitude: -6.83,
          gpsLongitude: 39.31,
          isDefault: true,
        },
      ])
      .returning({ id: supplierLocations.id });

    const feedstockRows = await tx
      .insert(feedstocks)
      .values([
        {
          organizationId: TEST_ORG_ID,
          code: `FS-DG-MISSING-${tag}`,
          facilityId: gapFacility.id,
          supplierId: missingGpsSupplier.id,
          feedstockTypeId: feedstockType.id,
          massDryKg: 100,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `FS-DG-FALLBACK-${tag}`,
          facilityId: gapFacility.id,
          supplierId: fallbackSupplier.id,
          feedstockTypeId: feedstockType.id,
          massDryKg: 100,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `FS-DG-LOCATION-${tag}`,
          facilityId: gapFacility.id,
          supplierId: locationSupplier.id,
          feedstockTypeId: feedstockType.id,
          massDryKg: 100,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `FS-DG-ARCHIVED-${tag}`,
          facilityId: gapFacility.id,
          supplierId: missingGpsSupplier.id,
          feedstockTypeId: feedstockType.id,
          massDryKg: 100,
          archivedAt: new Date(),
        },
        {
          organizationId: TEST_ORG_ID,
          code: `FS-DG-OTHER-${tag}`,
          facilityId: excludedFacility.id,
          supplierId: missingGpsSupplier.id,
          feedstockTypeId: feedstockType.id,
          massDryKg: 100,
        },
      ])
      .returning({ id: feedstocks.id });
    const [activeFeedstock, , , archivedFeedstock, excludedFeedstock] =
      feedstockRows;

    const [reactor] = await tx
      .insert(reactors)
      .values({
        organizationId: TEST_ORG_ID,
        code: `RE-DG-${tag}`,
        identifier: `Dashboard gap reactor ${tag}`,
        facilityId: gapFacility.id,
        reactorType: "fixed-bed",
      })
      .returning({ id: reactors.id });

    const productionRunRows = await tx
      .insert(productionRuns)
      .values([
        {
          organizationId: TEST_ORG_ID,
          code: `PR-DG-ACTIVE-${tag}`,
          facilityId: gapFacility.id,
          reactorId: reactor.id,
          status: "running",
          startTime: new Date("2026-07-01T08:00:00Z"),
        },
        {
          organizationId: TEST_ORG_ID,
          code: `PR-DG-CANCELLED-${tag}`,
          facilityId: gapFacility.id,
          reactorId: reactor.id,
          status: "cancelled",
          cancellationReason: "Excluded from active dashboard gap metrics",
          startTime: new Date("2026-07-02T08:00:00Z"),
        },
        {
          organizationId: TEST_ORG_ID,
          code: `PR-DG-ARCHIVED-${tag}`,
          facilityId: gapFacility.id,
          reactorId: reactor.id,
          status: "running",
          startTime: new Date("2026-07-03T08:00:00Z"),
          archivedAt: new Date(),
        },
      ])
      .returning({ id: productionRuns.id });
    const [activeRun, cancelledRun, archivedRun] = productionRunRows;

    const processRows = await tx
      .insert(productionProcesses)
      .values([
        {
          organizationId: TEST_ORG_ID,
          facilityId: gapFacility.id,
          feedstockTypeId: feedstockType.id,
        },
        {
          organizationId: TEST_ORG_ID,
          facilityId: excludedFacility.id,
          feedstockTypeId: feedstockType.id,
        },
      ])
      .returning({ id: productionProcesses.id });
    const [gapProcess, excludedProcess] = processRows;

    const batchRows = await tx
      .insert(creditBatches)
      .values([
        {
          organizationId: TEST_ORG_ID,
          code: `CB-DG-ACTIVE-${tag}`,
          facilityId: gapFacility.id,
          feedstockTypeId: feedstockType.id,
          productionProcessId: gapProcess.id,
          status: "draft",
          startDate: "2026-07-01",
          endDate: "2026-07-15",
        },
        {
          organizationId: TEST_ORG_ID,
          code: `CB-DG-OTHER-${tag}`,
          facilityId: excludedFacility.id,
          feedstockTypeId: feedstockType.id,
          productionProcessId: excludedProcess.id,
          status: "draft",
          startDate: "2026-07-01",
          endDate: "2026-07-15",
        },
        {
          organizationId: TEST_ORG_ID,
          code: `CB-DG-ARCHIVED-${tag}`,
          facilityId: gapFacility.id,
          feedstockTypeId: feedstockType.id,
          productionProcessId: gapProcess.id,
          status: "draft",
          startDate: "2026-07-16",
          endDate: "2026-07-31",
          archivedAt: new Date(),
        },
      ])
      .returning({ id: creditBatches.id });
    const [activeBatch, excludedBatch, archivedBatch] = batchRows;

    const sampleRows = await tx
      .insert(samples)
      .values([
        {
          organizationId: TEST_ORG_ID,
          creditBatchId: activeBatch.id,
          sampleCode: `S-DG-BATCH-${tag}`,
          samplingTime: new Date("2026-07-05T10:00:00Z"),
          ...SAMPLE_CHEMISTRY,
        },
        {
          organizationId: TEST_ORG_ID,
          productionRunId: activeRun.id,
          sampleCode: `S-DG-RUN-${tag}`,
          samplingTime: new Date("2026-07-06T10:00:00Z"),
          ...SAMPLE_CHEMISTRY,
        },
        {
          organizationId: TEST_ORG_ID,
          creditBatchId: excludedBatch.id,
          productionRunId: activeRun.id,
          sampleCode: `S-DG-CROSS-PARENT-${tag}`,
          samplingTime: new Date("2026-07-07T10:00:00Z"),
          ...SAMPLE_CHEMISTRY,
        },
        {
          organizationId: TEST_ORG_ID,
          creditBatchId: archivedBatch.id,
          productionRunId: activeRun.id,
          sampleCode: `S-DG-ARCHIVED-BATCH-${tag}`,
          samplingTime: new Date("2026-07-08T10:00:00Z"),
          ...SAMPLE_CHEMISTRY,
        },
        {
          organizationId: TEST_ORG_ID,
          productionRunId: cancelledRun.id,
          sampleCode: `S-DG-CANCELLED-RUN-${tag}`,
          samplingTime: new Date("2026-07-09T10:00:00Z"),
          ...SAMPLE_CHEMISTRY,
        },
        {
          organizationId: TEST_ORG_ID,
          productionRunId: archivedRun.id,
          sampleCode: `S-DG-ARCHIVED-RUN-${tag}`,
          samplingTime: new Date("2026-07-10T10:00:00Z"),
          ...SAMPLE_CHEMISTRY,
        },
      ])
      .returning({ id: samples.id });
    const [validBatchSample, validRunSample, ...excludedSamples] = sampleRows;

    const [activeBiocharProduct] = await tx
      .insert(biocharProducts)
      .values({
        organizationId: TEST_ORG_ID,
        code: `BP-DG-${tag}`,
        facilityId: gapFacility.id,
        linkedProductionRunId: activeRun.id,
      })
      .returning({ id: biocharProducts.id });

    const transportRows = await tx
      .insert(transportLegs)
      .values([
        {
          organizationId: TEST_ORG_ID,
          entityType: "feedstock",
          entityId: activeFeedstock.id,
          ...COMPLETE_ENDPOINTS,
          distanceKm: 25,
          distanceSource: "document",
          transportMethodType: "road",
          loadMassKg: 100,
        },
        {
          organizationId: TEST_ORG_ID,
          entityType: "biochar",
          entityId: activeBiocharProduct.id,
          originGpsLatitude: null,
          originGpsLongitude: null,
          destinationGpsLatitude: -6.16,
          destinationGpsLongitude: 35.75,
          distanceKm: 25,
          distanceSource: "manual",
          transportMethodType: "road",
          loadMassKg: 100,
        },
        {
          organizationId: TEST_ORG_ID,
          entityType: "sample",
          entityId: validBatchSample.id,
          originGpsLatitude: -6.16,
          originGpsLongitude: 35.75,
          destinationGpsLatitude: null,
          destinationGpsLongitude: null,
          distanceKm: 25,
          distanceSource: "document",
          transportMethodType: "road",
          loadMassKg: 1,
        },
        {
          organizationId: TEST_ORG_ID,
          entityType: "sample",
          entityId: validRunSample.id,
          ...COMPLETE_ENDPOINTS,
          distanceKm: 25,
          distanceSource: "manual",
          transportMethodType: "road",
          loadMassKg: 1,
        },
        ...excludedSamples.map((sample) => ({
          organizationId: TEST_ORG_ID,
          entityType: "sample" as const,
          entityId: sample.id,
          distanceKm: 25,
          distanceSource: null,
          transportMethodType: "road" as const,
          loadMassKg: 1,
        })),
        {
          organizationId: TEST_ORG_ID,
          entityType: "feedstock",
          entityId: archivedFeedstock.id,
          distanceKm: 25,
          distanceSource: null,
          transportMethodType: "road",
          loadMassKg: 100,
        },
        {
          organizationId: TEST_ORG_ID,
          entityType: "feedstock",
          entityId: excludedFeedstock.id,
          distanceKm: 25,
          distanceSource: null,
          transportMethodType: "road",
          loadMassKg: 100,
        },
        {
          organizationId: foreignOrgId,
          entityType: "biochar",
          entityId: activeBiocharProduct.id,
          distanceKm: 25,
          distanceSource: null,
          transportMethodType: "road",
          loadMassKg: 100,
        },
      ])
      .returning({ id: transportLegs.id });

    return {
      gapFacilityId: gapFacility.id,
      clearFacilityId: clearFacility.id,
      excludedFacilityId: excludedFacility.id,
      missingGpsSupplierId: missingGpsSupplier.id,
      activeBiocharProductId: activeBiocharProduct.id,
      validBatchSampleId: validBatchSample.id,
      activeFeedstockId: activeFeedstock.id,
      ids: {
        facilities: facilityRows.map(({ id }) => id),
        suppliers: supplierRows.map(({ id }) => id),
        supplierLocations: supplierLocationRows.map(({ id }) => id),
        feedstocks: feedstockRows.map(({ id }) => id),
        feedstockTypes: [feedstockType.id],
        reactors: [reactor.id],
        productionRuns: productionRunRows.map(({ id }) => id),
        productionProcesses: processRows.map(({ id }) => id),
        creditBatches: batchRows.map(({ id }) => id),
        samples: sampleRows.map(({ id }) => id),
        biocharProducts: [activeBiocharProduct.id],
        transportLegs: transportRows.map(({ id }) => id),
      },
      foreignOrgId,
    };
  });
});

afterAll(async () => {
  if (!fixture) return;
  const { ids } = fixture;
  await db.delete(transportLegs).where(inArray(transportLegs.id, ids.transportLegs));
  await db.delete(samples).where(inArray(samples.id, ids.samples));
  await db
    .delete(biocharProducts)
    .where(inArray(biocharProducts.id, ids.biocharProducts));
  await db.delete(creditBatches).where(inArray(creditBatches.id, ids.creditBatches));
  await db
    .delete(productionRuns)
    .where(inArray(productionRuns.id, ids.productionRuns));
  await db
    .delete(productionProcesses)
    .where(inArray(productionProcesses.id, ids.productionProcesses));
  await db.delete(reactors).where(inArray(reactors.id, ids.reactors));
  await db.delete(feedstocks).where(inArray(feedstocks.id, ids.feedstocks));
  await db
    .delete(supplierLocations)
    .where(inArray(supplierLocations.id, ids.supplierLocations));
  await db.delete(suppliers).where(inArray(suppliers.id, ids.suppliers));
  await db
    .delete(feedstockTypes)
    .where(inArray(feedstockTypes.id, ids.feedstockTypes));
  await db.delete(facilities).where(inArray(facilities.id, ids.facilities));
  await db.delete(organizations).where(eq(organizations.id, fixture.foreignOrgId));
});

describe("dashboard structural certification gaps", () => {
  it("uses canonical supplier GPS and scopes all transport parent types", async (ctx) => {
    if (!dbReachable || !fixture) {
      ctx.skip();
      return;
    }

    const counts = await loadDashboardStructuralGapCounts(
      makeTestOrgContext(TEST_USER_ID),
      fixture.gapFacilityId,
    );

    expect(counts).toEqual({
      missingFacilityGps: 1,
      missingFeedstockGps: 1,
      transportEndpointGpsGaps: 2,
      transportDistanceEvidenceGaps: 2,
      missingFeedstockGpsSupplierId: fixture.missingGpsSupplierId,
      transportEndpointGpsTarget: {
        entityType: "biochar",
        entityId: fixture.activeBiocharProductId,
      },
      transportDistanceEvidenceTarget: {
        entityType: "biochar",
        entityId: fixture.activeBiocharProductId,
      },
    });
    expect(
      buildDashboardStructuralGaps(counts, fixture.gapFacilityId).map(
        ({ key, count, href }) => ({ key, count, href }),
      ),
    ).toEqual([
      {
        key: "facilityGps",
        count: 1,
        href: `/facilities?facility=${fixture.gapFacilityId}`,
      },
      {
        key: "feedstockGps",
        count: 1,
        href: `/suppliers/${fixture.missingGpsSupplierId}?facility=${fixture.gapFacilityId}`,
      },
      {
        key: "transportEndpointGps",
        count: 2,
        href: `/biochar-products?facility=${fixture.gapFacilityId}&biocharProduct=${fixture.activeBiocharProductId}&mode=edit&focus=transport-route`,
      },
      {
        key: "transportDistanceEvidence",
        count: 2,
        href: `/biochar-products?facility=${fixture.gapFacilityId}&biocharProduct=${fixture.activeBiocharProductId}&mode=edit&focus=transport-evidence`,
      },
    ]);
  });

  it("builds supported parent deep links for feedstock and sample legs", () => {
    const facilityId = "00000000-0000-4000-8000-000000000001";
    const gaps = buildDashboardStructuralGaps(
      {
        missingFacilityGps: 0,
        missingFeedstockGps: 0,
        transportEndpointGpsGaps: 1,
        transportDistanceEvidenceGaps: 1,
        missingFeedstockGpsSupplierId: null,
        transportEndpointGpsTarget: {
          entityType: "sample",
          entityId: fixture?.validBatchSampleId ?? "sample-id",
        },
        transportDistanceEvidenceTarget: {
          entityType: "feedstock",
          entityId: fixture?.activeFeedstockId ?? "feedstock-id",
        },
      },
      facilityId,
    );

    expect(gaps.map(({ href }) => href)).toEqual([
      `/samples?facility=${facilityId}&sample=${fixture?.validBatchSampleId ?? "sample-id"}&mode=edit&focus=transport-route`,
      `/feedstocks?facility=${facilityId}&feedstock=${fixture?.activeFeedstockId ?? "feedstock-id"}&mode=edit&focus=transport-evidence`,
    ]);
  });

  it("returns no structural blockers for a complete empty facility", async (ctx) => {
    if (!dbReachable || !fixture) {
      ctx.skip();
      return;
    }

    const counts = await loadDashboardStructuralGapCounts(
      makeTestOrgContext(TEST_USER_ID),
      fixture.clearFacilityId,
    );

    expect(counts).toEqual({
      missingFacilityGps: 0,
      missingFeedstockGps: 0,
      transportEndpointGpsGaps: 0,
      transportDistanceEvidenceGaps: 0,
      missingFeedstockGpsSupplierId: null,
      transportEndpointGpsTarget: null,
      transportDistanceEvidenceTarget: null,
    });
    expect(buildDashboardStructuralGaps(counts, fixture.clearFacilityId)).toEqual([]);
  });
});
