/**
 * The partial-update contract against the real database (issue #770).
 *
 *  - `updateFeedstockType` judges the merged category/usage pair, so a patch
 *    naming only one half cannot land a combination the form would reject.
 *  - `updateFeedstock` owns the dry mass: a moisture-only edit re-derives it,
 *    and a client-supplied figure that disagrees is refused instead of
 *    persisting an impossible wet/moisture/dry triple.
 *  - An unrelated feedstock edit leaves a manually entered transport distance
 *    on the derived leg alone.
 *
 * Every fixture owns a unique organization and deletes it again, so the suite
 * can share the local database with other agents.
 */

import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  facilities,
  feedstocks,
  feedstockTypes,
  organizations,
  storageLocations,
  suppliers,
  transportLegs,
  users,
} from "@/db/schema";
import { updateFeedstock } from "@/data-access/feedstocks";
import { updateFeedstockType } from "@/data-access/feedstock-types";
import { resolveDistanceSource } from "@/schemas/distance-source";
import { updateFeedstockSchema } from "@/schemas/feedstocks";
import type { OrgContext } from "@/lib/auth/server";

const INTAKE_WET_KG = 100;
const INTAKE_MOISTURE_PERCENT = 20;
const INTAKE_DRY_KG = 80;
const REVISED_MOISTURE_PERCENT = 50;
const REVISED_DRY_KG = 50;
const DISAGREEING_DRY_KG = 90;
const MANUAL_DISTANCE_KM = 137;
const SUPPLIER_DISTANCE_KM = 42;

const CATEGORY_USAGE_MESSAGE =
  "Feedstock type was not saved because its category and usage disagree. " +
  "Review Category and Usage.";
const MASS_DISAGREEMENT_MESSAGE =
  "Feedstock was not saved because its mass values disagree. Review wet mass and moisture.";

const ORG_PREFIX = "e2e-patch-contract-org-";

interface Fixture {
  tag: string;
  ctx: OrgContext;
  facilityId: string;
  feedstockTypeId: string;
  feedstockId: string;
}

async function seedFixture(): Promise<Fixture> {
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const organizationId = `${ORG_PREFIX}${tag}`;
  const userId = `e2e-patch-contract-user-${tag}`;

  await db.insert(organizations).values({
    id: organizationId,
    name: `E2E Patch contract ${tag}`,
    slug: `e2e-patch-contract-${tag.toLowerCase()}`,
  });
  await db.insert(users).values({
    id: userId,
    name: "E2E patch contract operator",
    email: `patch-contract-${tag.toLowerCase()}@e2e.local`,
    emailVerified: true,
  });

  const ctx: OrgContext = {
    organizationId,
    userId,
    orgRole: "owner",
    isPlatformAdmin: false,
  };

  const [facility] = await db
    .insert(facilities)
    .values({
      organizationId,
      code: `E2E-PC-F-${tag}`,
      name: `E2E Patch contract ${tag}`,
    })
    .returning({ id: facilities.id });

  const [feedstockType] = await db
    .insert(feedstockTypes)
    .values({
      organizationId,
      code: `E2E-PC-T-${tag}`,
      name: `E2E Patch contract type ${tag}`,
      category: "forestry" as const,
      usage: "pyrolysis" as const,
    })
    .returning({ id: feedstockTypes.id });

  const [supplier] = await db
    .insert(suppliers)
    .values({
      organizationId,
      code: `E2E-PC-S-${tag}`,
      name: `E2E Patch contract supplier ${tag}`,
      distanceToFacilityKm: SUPPLIER_DISTANCE_KM,
      distanceSource: "manual" as const,
    })
    .returning({ id: suppliers.id });

  const [bin] = await db
    .insert(storageLocations)
    .values({
      organizationId,
      facilityId: facility.id,
      code: `E2E-PC-B-${tag}`,
      name: `E2E Patch contract bin ${tag}`,
      type: "feedstock_bin",
      feedstockTypeId: feedstockType.id,
      capacityKg: 10_000,
    })
    .returning({ id: storageLocations.id });

  const [feedstock] = await db
    .insert(feedstocks)
    .values({
      organizationId,
      code: `E2E-PC-FS-${tag}`,
      facilityId: facility.id,
      status: "complete",
      feedstockTypeId: feedstockType.id,
      supplierId: supplier.id,
      massDryKg: INTAKE_DRY_KG,
      massWetKg: INTAKE_WET_KG,
      moistureContentPercent: INTAKE_MOISTURE_PERCENT,
      storageLocationId: bin.id,
    })
    .returning({ id: feedstocks.id });

  return {
    tag,
    ctx,
    facilityId: facility.id,
    feedstockTypeId: feedstockType.id,
    feedstockId: feedstock.id,
  };
}

async function cleanup(fixture: Fixture): Promise<void> {
  const { organizationId } = fixture.ctx;
  if (!organizationId.startsWith(ORG_PREFIX)) {
    throw new Error("Expected an isolated partial-update test organization");
  }
  await db.transaction(async (tx) => {
    for (const table of [
      "bin_movements",
      "transport_legs",
      "feedstocks",
      "storage_locations",
      "feedstock_types",
      "suppliers",
      "facilities",
    ]) {
      await tx.execute(
        sql`delete from ${sql.identifier(table)} where organization_id = ${organizationId}`,
      );
    }
    await tx.delete(organizations).where(eq(organizations.id, organizationId));
    await tx.delete(users).where(eq(users.id, fixture.ctx.userId));
  });
}

/**
 * Mirror `updateFeedstockFn`: parse the patch with the action schema, then
 * hand the rest to data access. Going through the schema is the point — the
 * omitted-vs-cleared distinction is established there.
 */
async function applyFeedstockPatch(
  fixture: Fixture,
  input: Record<string, unknown>,
) {
  const {
    feedstockId,
    transportDistanceKm,
    transportDistanceSource,
    transportTripType,
    ...updateData
  } = updateFeedstockSchema.parse({
    feedstockId: fixture.feedstockId,
    ...input,
  });

  return updateFeedstock(fixture.ctx, feedstockId, {
    ...updateData,
    transportDistanceKm,
    transportDistanceSource: resolveDistanceSource(
      transportDistanceKm,
      transportDistanceSource,
    ),
    transportTripType,
  });
}

async function readFeedstockMasses(fixture: Fixture) {
  const [row] = await db
    .select({
      massWetKg: feedstocks.massWetKg,
      massDryKg: feedstocks.massDryKg,
      moistureContentPercent: feedstocks.moistureContentPercent,
    })
    .from(feedstocks)
    .where(eq(feedstocks.id, fixture.feedstockId));
  return row;
}

async function readDerivedLegDistanceKm(
  fixture: Fixture,
): Promise<number | null | undefined> {
  const [row] = await db
    .select({ distanceKm: transportLegs.distanceKm })
    .from(transportLegs)
    .where(eq(transportLegs.entityId, fixture.feedstockId));
  return row?.distanceKm;
}

async function readFeedstockType(fixture: Fixture) {
  const [row] = await db
    .select({
      category: feedstockTypes.category,
      usage: feedstockTypes.usage,
      name: feedstockTypes.name,
    })
    .from(feedstockTypes)
    .where(eq(feedstockTypes.id, fixture.feedstockTypeId));
  return row;
}

describe("partial-update contract (database)", () => {
  let fixture: Fixture | null = null;

  afterEach(async () => {
    if (fixture) await cleanup(fixture);
    fixture = null;
  });

  it("refuses a usage-only patch that conflicts with the stored category", async () => {
    fixture = await seedFixture();

    // "forestry" is a pyrolysis category, so flipping usage alone to blend
    // leaves the row in a combination the create form would reject.
    await expect(
      updateFeedstockType(fixture.ctx, {
        feedstockTypeId: fixture.feedstockTypeId,
        usage: "blend",
      }),
    ).rejects.toThrow(CATEGORY_USAGE_MESSAGE);

    expect(await readFeedstockType(fixture)).toMatchObject({
      category: "forestry",
      usage: "pyrolysis",
    });
  });

  it("refuses a category-only patch that conflicts with the stored usage", async () => {
    fixture = await seedFixture();

    await expect(
      updateFeedstockType(fixture.ctx, {
        feedstockTypeId: fixture.feedstockTypeId,
        category: "compost",
      }),
    ).rejects.toThrow(CATEGORY_USAGE_MESSAGE);

    expect(await readFeedstockType(fixture)).toMatchObject({
      category: "forestry",
    });
  });

  it("accepts a patch that moves both halves of the pair together", async () => {
    fixture = await seedFixture();

    await updateFeedstockType(fixture.ctx, {
      feedstockTypeId: fixture.feedstockTypeId,
      category: "compost",
      usage: "blend",
    });

    expect(await readFeedstockType(fixture)).toMatchObject({
      category: "compost",
      usage: "blend",
    });
  });

  it("accepts a patch that touches neither half", async () => {
    fixture = await seedFixture();
    const renamed = `E2E Patch contract renamed ${fixture.tag}`;

    await updateFeedstockType(fixture.ctx, {
      feedstockTypeId: fixture.feedstockTypeId,
      name: renamed,
    });

    expect(await readFeedstockType(fixture)).toMatchObject({
      name: renamed,
      category: "forestry",
      usage: "pyrolysis",
    });
  });

  it("re-derives dry mass from a moisture-only edit", async () => {
    fixture = await seedFixture();

    await applyFeedstockPatch(fixture, {
      moistureContentPercent: REVISED_MOISTURE_PERCENT,
    });

    expect(await readFeedstockMasses(fixture)).toMatchObject({
      massWetKg: INTAKE_WET_KG,
      moistureContentPercent: REVISED_MOISTURE_PERCENT,
      massDryKg: REVISED_DRY_KG,
    });
  });

  it("refuses a dry mass that disagrees with the wet mass and moisture", async () => {
    fixture = await seedFixture();

    await expect(
      applyFeedstockPatch(fixture, {
        massWetKg: INTAKE_WET_KG,
        moistureContentPercent: REVISED_MOISTURE_PERCENT,
        massDryKg: DISAGREEING_DRY_KG,
      }),
    ).rejects.toThrow(MASS_DISAGREEMENT_MESSAGE);

    expect(await readFeedstockMasses(fixture)).toMatchObject({
      massWetKg: INTAKE_WET_KG,
      moistureContentPercent: INTAKE_MOISTURE_PERCENT,
      massDryKg: INTAKE_DRY_KG,
    });
  });

  it("accepts a dry mass that agrees with the derivation", async () => {
    fixture = await seedFixture();

    await applyFeedstockPatch(fixture, {
      massWetKg: INTAKE_WET_KG,
      moistureContentPercent: REVISED_MOISTURE_PERCENT,
      massDryKg: REVISED_DRY_KG,
    });

    expect(await readFeedstockMasses(fixture)).toMatchObject({
      massDryKg: REVISED_DRY_KG,
    });
  });

  it("keeps a manual transport distance through an unrelated edit", async () => {
    fixture = await seedFixture();

    await applyFeedstockPatch(fixture, {
      transportDistanceKm: MANUAL_DISTANCE_KM,
      transportDistanceSource: "manual",
    });
    expect(await readDerivedLegDistanceKm(fixture)).toBe(MANUAL_DISTANCE_KM);

    await applyFeedstockPatch(fixture, { notes: "Weighbridge ticket filed." });

    expect(await readDerivedLegDistanceKm(fixture)).toBe(MANUAL_DISTANCE_KM);
  });

  it("clears the manual distance back to the supplier default when emptied", async () => {
    fixture = await seedFixture();

    await applyFeedstockPatch(fixture, {
      transportDistanceKm: MANUAL_DISTANCE_KM,
      transportDistanceSource: "manual",
    });
    await applyFeedstockPatch(fixture, { transportDistanceKm: "" });

    expect(await readDerivedLegDistanceKm(fixture)).toBe(SUPPLIER_DISTANCE_KM);
  });
});
