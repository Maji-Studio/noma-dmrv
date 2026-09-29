/**
 * One output bin with unresolved stock must not fail the storage-location list.
 *
 * A completed production run without dry mass leaves its biochar bin's stock
 * unresolved. The bin's tile already reads "unavailable"; the lane summary used
 * to let `UnresolvedOutputStockError` escape instead, so the whole list 500'd.
 *
 * An unavailable database fails setup so the regression cannot report a false
 * pass without executing its assertions.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { getStorageLocations } from "@/data-access/storage-locations";
import { facilities } from "@/db/schema/facilities";
import { productionRuns, reactors, storageLocations } from "@/db/schema";
import { COMPLETED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const RUN_ID_LENGTH = 8;

interface Fixture {
  facilityId: string;
  reactorId: string;
  binId: string;
  runId: string;
}

let fixture: Fixture | null = null;

function requireFixture(): Fixture {
  if (!fixture) throw new Error("Unresolved bin fixture was not created");
  return fixture;
}

beforeAll(async () => {
  const tag = crypto.randomUUID().slice(0, RUN_ID_LENGTH);
  await ensureTestOrg();
  fixture = await db.transaction(async (tx) => {
    const [facility] = await tx
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        name: `Unresolved Bin Facility ${tag}`,
        code: `FAC-UNRES-${tag}`,
      })
      .returning({ id: facilities.id });

    const [reactor] = await tx
      .insert(reactors)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `RE-UNRES-${tag}`,
        identifier: `Unresolved bin reactor ${tag}`,
        reactorType: "fixed-bed",
      })
      .returning({ id: reactors.id });

    const [bin] = await tx
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `BB-UNRES-${tag}`,
        name: `Unresolved Biochar Bin ${tag}`,
        type: "biochar_bin",
      })
      .returning({ id: storageLocations.id });

    const [run] = await tx
      .insert(productionRuns)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        reactorId: reactor.id,
        code: `PR-UNRES-${tag}`,
        status: COMPLETED_PRODUCTION_RUN_STATUS,
        startTime: new Date("2026-06-01T08:00:00Z"),
        endTime: new Date("2026-06-01T12:00:00Z"),
        biocharStorageLocationId: bin.id,
        biocharDryMassKg: null,
      })
      .returning({ id: productionRuns.id });

    return {
      facilityId: facility.id,
      reactorId: reactor.id,
      binId: bin.id,
      runId: run.id,
    };
  });
});

afterAll(async () => {
  if (!fixture) return;
  await db.delete(productionRuns).where(eq(productionRuns.id, fixture.runId));
  await db.delete(reactors).where(eq(reactors.id, fixture.reactorId));
  await db.delete(storageLocations).where(eq(storageLocations.id, fixture.binId));
  await db.delete(facilities).where(eq(facilities.id, fixture.facilityId));
});

describe("storage location list with an unresolved output bin", () => {
  it("still returns, with the bin and its lane total unavailable", async () => {
    const { facilityId, binId } = requireFixture();
    const result = await getStorageLocations(makeTestOrgContext(), {
      facilityId,
    });

    const bin = result.items.find((item) => item.id === binId);
    expect(bin?.biocharInventory.dryMassKg).toBeNull();
    expect(bin?.biocharInventory.currentMassKg).toBeNull();
    expect(result.laneSummary.biochar_bin).toEqual({
      binCount: 1,
      onHandKg: null,
    });
    // Other lanes are unaffected.
    expect(result.laneSummary.feedstock_bin.onHandKg).toBe(0);
    expect(result.laneSummary.product_bin.onHandKg).toBe(0);
  });
});
