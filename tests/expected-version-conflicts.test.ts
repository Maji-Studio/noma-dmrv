/**
 * Expected-version conflict check (issue #768, F03).
 *
 * A consequential edit form echoes back the `updatedAt` it loaded. The updater
 * compares it against the row it locked and refuses the save when they differ,
 * so two operators who opened the same record cannot silently overwrite each
 * other. These run against the real database because the guard lives inside the
 * updater's transaction, next to the locked read it depends on.
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
  users,
} from "@/db/schema";
import { updateFacility } from "@/data-access/facility-mutations";
import { updateFeedstock } from "@/data-access/feedstocks";
import {
  STALE_VERSION_CONFLICT_CODE,
  STALE_VERSION_MESSAGE,
} from "@/lib/stale-version";
import type { OrgContext } from "@/lib/auth/server";

const ORG_PREFIX = "e2e-expected-version-org-";
const INTAKE_WET_KG = 100;
const INTAKE_DRY_KG = 80;
const MOISTURE_PERCENT = 20;
const FIRST_EDIT_WET_KG = 90;
const SECOND_EDIT_WET_KG = 70;
const DRY_RATIO = INTAKE_DRY_KG / INTAKE_WET_KG;

const STALE_CONFLICT = {
  name: "ActionConflictError",
  message: STALE_VERSION_MESSAGE,
  conflict: { code: STALE_VERSION_CONFLICT_CODE },
};

interface Fixture {
  tag: string;
  ctx: OrgContext;
  facilityId: string;
  feedstockId: string;
}

async function seedFixture(): Promise<Fixture> {
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const organizationId = `${ORG_PREFIX}${tag}`;
  const userId = `e2e-expected-version-user-${tag}`;

  await db.insert(organizations).values({
    id: organizationId,
    name: `E2E Expected version ${tag}`,
    slug: `e2e-expected-version-${tag.toLowerCase()}`,
  });
  await db.insert(users).values({
    id: userId,
    name: "E2E expected version operator",
    email: `expected-version-${tag.toLowerCase()}@e2e.local`,
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
      code: `E2E-EXPV-F-${tag}`,
      name: `E2E Expected version ${tag}`,
      country: "Tanzania",
    })
    .returning({ id: facilities.id });

  const [feedstockType] = await db
    .insert(feedstockTypes)
    .values({
      organizationId,
      code: `E2E-EXPV-T-${tag}`,
      name: `E2E Expected version type ${tag}`,
      category: "forestry" as const,
      usage: "pyrolysis" as const,
    })
    .returning({ id: feedstockTypes.id });

  const [bin] = await db
    .insert(storageLocations)
    .values({
      organizationId,
      facilityId: facility.id,
      code: `E2E-EXPV-B-${tag}`,
      name: `E2E Expected version bin ${tag}`,
      type: "feedstock_bin",
      feedstockTypeId: feedstockType.id,
      capacityKg: 10_000,
    })
    .returning({ id: storageLocations.id });

  const [feedstock] = await db
    .insert(feedstocks)
    .values({
      organizationId,
      code: `E2E-EXPV-FS-${tag}`,
      facilityId: facility.id,
      status: "complete",
      feedstockTypeId: feedstockType.id,
      massDryKg: INTAKE_DRY_KG,
      massWetKg: INTAKE_WET_KG,
      moistureContentPercent: MOISTURE_PERCENT,
      storageLocationId: bin.id,
    })
    .returning({ id: feedstocks.id });

  return { tag, ctx, facilityId: facility.id, feedstockId: feedstock.id };
}

async function cleanup(fixture: Fixture): Promise<void> {
  const { organizationId } = fixture.ctx;
  if (!organizationId.startsWith(ORG_PREFIX)) {
    throw new Error("Expected an isolated expected-version test organization");
  }
  await db.transaction(async (tx) => {
    for (const table of [
      "bin_movements",
      "transport_legs",
      "feedstocks",
      "storage_locations",
      "feedstock_types",
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

async function readFacility(fixture: Fixture) {
  const [row] = await db
    .select({
      name: facilities.name,
      location: facilities.location,
      country: facilities.country,
      updatedAt: facilities.updatedAt,
    })
    .from(facilities)
    .where(eq(facilities.id, fixture.facilityId));
  return row;
}

async function readFeedstock(fixture: Fixture) {
  const [row] = await db
    .select({
      massWetKg: feedstocks.massWetKg,
      massDryKg: feedstocks.massDryKg,
      notes: feedstocks.notes,
      updatedAt: feedstocks.updatedAt,
    })
    .from(feedstocks)
    .where(eq(feedstocks.id, fixture.feedstockId));
  return row;
}

const fixtures: Fixture[] = [];
async function fixture(): Promise<Fixture> {
  const created = await seedFixture();
  fixtures.push(created);
  return created;
}
afterEach(async () => {
  for (const created of fixtures.splice(0)) await cleanup(created);
});

describe("facility saves carry an expected version", () => {
  it("refuses the second of two snapshots taken from the same read", async () => {
    const f = await fixture();
    const opened = (await readFacility(f))!.updatedAt;

    await updateFacility(f.ctx, f.facilityId, {
      name: `First writer ${f.tag}`,
      expectedUpdatedAt: opened,
    });

    await expect(
      updateFacility(f.ctx, f.facilityId, {
        name: `Second writer ${f.tag}`,
        expectedUpdatedAt: opened,
      }),
    ).rejects.toMatchObject({
      ...STALE_CONFLICT,
      conflict: { ...STALE_CONFLICT.conflict, entity: "facility", id: f.facilityId },
    });

    expect((await readFacility(f))!.name).toBe(`First writer ${f.tag}`);
  });

  it("refuses an unrelated-metadata edit built on a stale read", async () => {
    const f = await fixture();
    const opened = (await readFacility(f))!.updatedAt;

    await updateFacility(f.ctx, f.facilityId, { country: "Kenya" });

    await expect(
      updateFacility(f.ctx, f.facilityId, {
        location: "Stale writer's town",
        expectedUpdatedAt: opened,
      }),
    ).rejects.toMatchObject(STALE_CONFLICT);

    const after = (await readFacility(f))!;
    expect(after.location).toBeNull();
    expect(after.country).toBe("Kenya");
  });

  it("saves when the expected version matches the stored row", async () => {
    const f = await fixture();
    const opened = (await readFacility(f))!.updatedAt;

    await updateFacility(f.ctx, f.facilityId, {
      location: "Matching writer's town",
      expectedUpdatedAt: opened,
    });

    expect((await readFacility(f))!.location).toBe("Matching writer's town");
  });

  it("still saves when the payload carries no expected version", async () => {
    const f = await fixture();
    await updateFacility(f.ctx, f.facilityId, { country: "Kenya" });

    await updateFacility(f.ctx, f.facilityId, {
      location: "Versionless writer's town",
    });

    expect((await readFacility(f))!.location).toBe("Versionless writer's town");
  });
});

describe("feedstock saves carry an expected version", () => {
  it("refuses the second of two snapshots taken from the same read", async () => {
    const f = await fixture();
    const opened = (await readFeedstock(f))!.updatedAt;

    await updateFeedstock(f.ctx, f.feedstockId, {
      massWetKg: FIRST_EDIT_WET_KG,
      massDryKg: FIRST_EDIT_WET_KG * DRY_RATIO,
      expectedUpdatedAt: opened,
    });

    await expect(
      updateFeedstock(f.ctx, f.feedstockId, {
        massWetKg: SECOND_EDIT_WET_KG,
        massDryKg: SECOND_EDIT_WET_KG * DRY_RATIO,
        expectedUpdatedAt: opened,
      }),
    ).rejects.toMatchObject({
      ...STALE_CONFLICT,
      conflict: {
        ...STALE_CONFLICT.conflict,
        entity: "feedstock",
        id: f.feedstockId,
      },
    });

    expect((await readFeedstock(f))!.massWetKg).toBe(FIRST_EDIT_WET_KG);
  });

  it("refuses an unrelated-metadata edit built on a stale read", async () => {
    const f = await fixture();
    const opened = (await readFeedstock(f))!.updatedAt;

    await updateFeedstock(f.ctx, f.feedstockId, {
      massWetKg: FIRST_EDIT_WET_KG,
      massDryKg: FIRST_EDIT_WET_KG * DRY_RATIO,
    });

    await expect(
      updateFeedstock(f.ctx, f.feedstockId, {
        notes: "Stale writer's note",
        expectedUpdatedAt: opened,
      }),
    ).rejects.toMatchObject(STALE_CONFLICT);

    const after = (await readFeedstock(f))!;
    expect(after.notes).toBeNull();
    expect(after.massWetKg).toBe(FIRST_EDIT_WET_KG);
  });

  it("refuses a mass edit built on a stale read", async () => {
    const f = await fixture();
    const opened = (await readFeedstock(f))!.updatedAt;

    await updateFeedstock(f.ctx, f.feedstockId, { notes: "First writer's note" });

    await expect(
      updateFeedstock(f.ctx, f.feedstockId, {
        massWetKg: SECOND_EDIT_WET_KG,
        massDryKg: SECOND_EDIT_WET_KG * DRY_RATIO,
        expectedUpdatedAt: opened,
      }),
    ).rejects.toMatchObject(STALE_CONFLICT);

    const after = (await readFeedstock(f))!;
    expect(after.massWetKg).toBe(INTAKE_WET_KG);
    expect(after.notes).toBe("First writer's note");
  });

  it("saves when the expected version matches the stored row", async () => {
    const f = await fixture();
    const opened = (await readFeedstock(f))!.updatedAt;

    await updateFeedstock(f.ctx, f.feedstockId, {
      massWetKg: FIRST_EDIT_WET_KG,
      massDryKg: FIRST_EDIT_WET_KG * DRY_RATIO,
      expectedUpdatedAt: opened,
    });

    expect((await readFeedstock(f))!.massWetKg).toBe(FIRST_EDIT_WET_KG);
  });

  it("still saves when the payload carries no expected version", async () => {
    const f = await fixture();
    await updateFeedstock(f.ctx, f.feedstockId, { notes: "First writer's note" });

    await updateFeedstock(f.ctx, f.feedstockId, {
      massWetKg: SECOND_EDIT_WET_KG,
      massDryKg: SECOND_EDIT_WET_KG * DRY_RATIO,
    });

    expect((await readFeedstock(f))!.massWetKg).toBe(SECOND_EDIT_WET_KG);
  });
});
