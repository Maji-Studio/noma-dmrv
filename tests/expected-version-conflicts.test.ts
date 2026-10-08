import { masterDataVersion } from "./helpers/master-data-version";
/**
 * Expected-version conflict check (issue #768, F03).
 *
 * An edit form echoes back the version it loaded: an integer for feedstocks,
 * `updatedAt` for the remaining timestamp-based writers. The updater compares
 * it against the row it locked and refuses the save when they differ,
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
import { archiveFacility, restoreFacility } from "@/data-access/facilities";
import { DomainError } from "@/lib/domain-errors";
import { updateFeedstock, deleteFeedstock } from "@/lib/operations/feedstocks";
import { runOperationInProcess } from "@/lib/operations/runner";
import { createTestPool } from "./helpers/operation-fixture";
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
const TAG_LENGTH = 8;
const BIN_CAPACITY_KG = 10_000;
const VERSION_INCREMENT = 1;
const CONCURRENT_WRITERS = 2;
const CASCADE_TRANSITIONS = 2;
const EXPECTED_COMMITS = 1;

const STALE_CONFLICT = {
  name: "DomainError",
  code: "stale_version",
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
  const tag = randomUUID().slice(0, TAG_LENGTH).toUpperCase();
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
      capacityKg: BIN_CAPACITY_KG,
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
      version: facilities.version,
      updatedAt: facilities.updatedAt,
    })
    .from(facilities)
    .where(eq(facilities.id, fixture.facilityId));
  return row;
}

async function readFeedstock(fixture: Fixture) {
  const [row] = await db
    .select()
    .from(feedstocks)
    .where(eq(feedstocks.id, fixture.feedstockId));
  return row;
}

function expectStaleFeedstock(error: unknown, fixture: Fixture): void {
  expect(error).toBeInstanceOf(DomainError);
  if (!(error instanceof DomainError)) throw error;
  expect(error.code).toBe("stale_version");
  expect(error.message).toBe(STALE_VERSION_MESSAGE);
  expect(error.conflict).toEqual({
    entity: "feedstock",
    id: fixture.feedstockId,
    code: STALE_VERSION_CONFLICT_CODE,
  });
}

async function expectStaleRefusal(promise: Promise<unknown>, fixture: Fixture) {
  const error = await promise.then(
    () => { throw new Error("Expected a stale feedstock refusal"); },
    (failure: unknown) => failure,
  );
  expectStaleFeedstock(error, fixture);
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
    const opened = (await readFacility(f))!.version;

    await updateFacility(f.ctx, f.facilityId, {
      name: `First writer ${f.tag}`,
      expectedVersion: opened,
    });

    await expect(
      updateFacility(f.ctx, f.facilityId, {
        name: `Second writer ${f.tag}`,
        expectedVersion: opened,
      }),
    ).rejects.toMatchObject({
      ...STALE_CONFLICT,
      conflict: { ...STALE_CONFLICT.conflict, entity: "facility", id: f.facilityId },
    });

    expect((await readFacility(f))!.name).toBe(`First writer ${f.tag}`);
  });

  it("refuses an unrelated-metadata edit built on a stale read", async () => {
    const f = await fixture();
    const opened = (await readFacility(f))!.version;

    await updateFacility(f.ctx, f.facilityId, { country: "Kenya", expectedVersion: opened });

    await expect(
      updateFacility(f.ctx, f.facilityId, {
        location: "Stale writer's town",
        expectedVersion: opened,
      }),
    ).rejects.toMatchObject(STALE_CONFLICT);

    const after = (await readFacility(f))!;
    expect(after.location).toBeNull();
    expect(after.country).toBe("Kenya");
  });

  it("saves when the expected version matches the stored row", async () => {
    const f = await fixture();
    const opened = (await readFacility(f))!.version;

    await updateFacility(f.ctx, f.facilityId, {
      location: "Matching writer's town",
      expectedVersion: opened,
    });

    expect((await readFacility(f))!.location).toBe("Matching writer's town");
  });


});

describe("feedstock row versions", () => {
  it("updates with the current version and returns the next version", async () => {
    const f = await fixture();
    const opened = (await readFeedstock(f))!;

    const saved = await runOperationInProcess(updateFeedstock, f.ctx, {
      feedstockId: f.feedstockId,
      massWetKg: FIRST_EDIT_WET_KG,
      massDryKg: FIRST_EDIT_WET_KG * DRY_RATIO,
      expectedVersion: opened.version,
    });

    expect(saved.version).toBe(opened.version + VERSION_INCREMENT);
    const stored = (await readFeedstock(f))!;
    expect(stored.version).toBe(saved.version);
    expect(stored.massWetKg).toBe(FIRST_EDIT_WET_KG);
    expect(stored.massDryKg).toBe(FIRST_EDIT_WET_KG * DRY_RATIO);
  });

  it("refuses a stale update with its conflict ref and leaves the row unchanged", async () => {
    const f = await fixture();
    const opened = (await readFeedstock(f))!;
    await runOperationInProcess(updateFeedstock, f.ctx, {
      feedstockId: f.feedstockId,
      notes: "First writer's note",
      expectedVersion: opened.version,
    });
    const beforeRefusal = (await readFeedstock(f))!;

    await expectStaleRefusal(runOperationInProcess(updateFeedstock, f.ctx, {
      feedstockId: f.feedstockId,
      massWetKg: SECOND_EDIT_WET_KG,
      massDryKg: SECOND_EDIT_WET_KG * DRY_RATIO,
      notes: "Stale writer's note",
      expectedVersion: opened.version,
    }), f);

    expect(await readFeedstock(f)).toEqual(beforeRefusal);
  });

  it("refuses a stale delete and keeps the row present", async () => {
    const f = await fixture();
    const opened = (await readFeedstock(f))!;
    await runOperationInProcess(updateFeedstock, f.ctx, {
      feedstockId: f.feedstockId,
      notes: "Newer edit",
      expectedVersion: opened.version,
    });
    const beforeRefusal = (await readFeedstock(f))!;

    await expectStaleRefusal(runOperationInProcess(deleteFeedstock, f.ctx, {
      feedstockId: f.feedstockId,
      expectedVersion: opened.version,
    }), f);

    expect(await readFeedstock(f)).toEqual(beforeRefusal);
  });

  it("bumps every feedstock version on facility archive and again on restore", async () => {
    const f = await fixture();
    const opened = (await readFeedstock(f))!;
    const [sibling] = await db.insert(feedstocks).values({
      ...opened,
      id: randomUUID(),
      code: `E2E-EXPV-SIBLING-${f.tag}`,
      version: opened.version + VERSION_INCREMENT,
    }).returning();
    const affected = [opened, sibling];

    const archivedFacility = await archiveFacility(f.ctx, f.facilityId, await masterDataVersion(f.ctx, "facilities", f.facilityId));
    for (const row of affected) {
      const archived = (await readFeedstock({ ...f, feedstockId: row.id }))!;
      expect(archived.archivedAt).toBeInstanceOf(Date);
      expect(archived.version).toBe(row.version + VERSION_INCREMENT);
    }

    await restoreFacility(f.ctx, f.facilityId, archivedFacility.version);
    for (const row of affected) {
      const restored = (await readFeedstock({ ...f, feedstockId: row.id }))!;
      expect(restored.archivedAt).toBeNull();
      expect(restored.version).toBe(row.version + VERSION_INCREMENT * CASCADE_TRANSITIONS);
    }
  });

  it("commits exactly one concurrent update from the same loaded version", async () => {
    const f = await fixture();
    const opened = (await readFeedstock(f))!;
    const pool = createTestPool(CONCURRENT_WRITERS);
    const edits = ["Concurrent first note", "Concurrent second note"];
    try {
      // A dedicated pool gives each runner its own transaction connection.
      const outcomes = await Promise.allSettled(edits.map((notes) =>
        runOperationInProcess(updateFeedstock, f.ctx, {
          feedstockId: f.feedstockId,
          notes,
          expectedVersion: opened.version,
        }, { pool }),
      ));
      const committed = outcomes.filter((outcome) => outcome.status === "fulfilled");
      const refused = outcomes.filter((outcome) => outcome.status === "rejected");
      expect(committed).toHaveLength(EXPECTED_COMMITS);
      expect(refused).toHaveLength(CONCURRENT_WRITERS - EXPECTED_COMMITS);
      expectStaleFeedstock(refused[0].reason, f);
      expect(committed[0].value.version).toBe(opened.version + VERSION_INCREMENT);

      const stored = (await readFeedstock(f))!;
      expect(stored.version).toBe(opened.version + VERSION_INCREMENT);
      expect(stored.notes).toBe(committed[0].value.notes);
      expect(edits).toContain(stored.notes);
      expect(stored.massWetKg).toBe(opened.massWetKg);
      expect(stored.massDryKg).toBe(opened.massDryKg);
    } finally {
      await pool.end();
    }
  });
});
