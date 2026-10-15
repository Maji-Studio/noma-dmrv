import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { applicationOutputAllocations, biocharProducts, deliveries, transportLegs } from "@/db/schema";
import { resolveScopeForRemoval } from "@/fn/certification/certify-context-core";
import { loadTransportLegsByCategory } from "@/fn/certification/shared";
import { updateTransportLeg } from "@/data-access/transport-legs";
import { aggregateBiocharTransportMassDistance } from "@/lib/isometric/utils/aggregation";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { deleteOutputProductFixtures, outputProductFixtureValues } from "./helpers/output-contract-fixtures";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const ctx = makeTestOrgContext();
const HALF_WET_KG = 100;
const HALF_DRY_KG = 95;
const DISTANCE_KM = 10;
const EXPECTED_TONNE_KM = 4;

beforeAll(() => ensureTestOrg());

describe("Removal delivery transport", () => {
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
