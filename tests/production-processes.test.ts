/**
 * Production Process Data Access Tests
 *
 * Integration tests for findOrCreateProductionProcess (ADR 0016): the
 * (facility, feedstock) sampling-regime campaign that scopes Method A/B. A
 * credit batch auto-finds-or-creates one when it is formed, defaulting to
 * Method A; the "current" process for a pair is the most recently established.
 *
 * Requires a running database (uses DATABASE_URL from .env.test or test defaults).
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema/facilities";
import { feedstockTypes } from "@/db/schema/feedstock";
import { productionProcesses } from "@/db/schema/production-processes";
import { findOrCreateProductionProcess } from "@/data-access/production-processes";

const TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000001";

const createdIds = {
  facilities: [] as string[],
  feedstockTypes: [] as string[],
};

let facilityId: string;
let feedstockTypeId: string;

beforeAll(async () => {
  const runId = Date.now().toString(36);

  const [facility] = await db
    .insert(facilities)
    .values({ name: `Process Test Facility ${runId}`, code: `FAC-PROC-${runId}` })
    .returning({ id: facilities.id });
  facilityId = facility.id;
  createdIds.facilities.push(facility.id);

  const [feedstockType] = await db
    .insert(feedstockTypes)
    .values({
      name: `Process Test Feedstock ${runId}`,
      code: `FT-PROC-${runId}`,
      category: "forestry",
    })
    .returning({ id: feedstockTypes.id });
  feedstockTypeId = feedstockType.id;
  createdIds.feedstockTypes.push(feedstockType.id);
});

afterAll(async () => {
  await db.transaction(async (tx) => {
    await tx
      .delete(productionProcesses)
      .where(inArray(productionProcesses.facilityId, createdIds.facilities));
    if (createdIds.feedstockTypes.length > 0) {
      await tx
        .delete(feedstockTypes)
        .where(inArray(feedstockTypes.id, createdIds.feedstockTypes));
    }
    if (createdIds.facilities.length > 0) {
      await tx
        .delete(facilities)
        .where(inArray(facilities.id, createdIds.facilities));
    }
  });
});

describe("findOrCreateProductionProcess", () => {
  it("creates a Method A process when none exists for the pair", async () => {
    const process = await findOrCreateProductionProcess(TEST_USER_ID, {
      facilityId,
      feedstockTypeId,
    });

    expect(process.facilityId).toBe(facilityId);
    expect(process.feedstockTypeId).toBe(feedstockTypeId);
    expect(process.samplingMethod).toBe("method_a");
    expect(process.methodBUnlockedAt).toBeNull();
    expect(process.establishedAt).toBeInstanceOf(Date);
  });

  it("is idempotent — a second call returns the same process, not a duplicate", async () => {
    const first = await findOrCreateProductionProcess(TEST_USER_ID, {
      facilityId,
      feedstockTypeId,
    });
    const second = await findOrCreateProductionProcess(TEST_USER_ID, {
      facilityId,
      feedstockTypeId,
    });

    expect(second.id).toBe(first.id);

    const rows = await db
      .select({ id: productionProcesses.id })
      .from(productionProcesses)
      .where(inArray(productionProcesses.facilityId, [facilityId]));
    expect(rows).toHaveLength(1);
  });

  it("returns the most recently established process when several exist for the pair", async () => {
    // A feedstock/condition change opens a NEW process and resets the baseline;
    // the current one is the latest established. Insert a newer process directly.
    const [newer] = await db
      .insert(productionProcesses)
      .values({
        facilityId,
        feedstockTypeId,
        establishedAt: new Date("2999-01-01T00:00:00.000Z"),
      })
      .returning({ id: productionProcesses.id });

    const resolved = await findOrCreateProductionProcess(TEST_USER_ID, {
      facilityId,
      feedstockTypeId,
    });

    expect(resolved.id).toBe(newer.id);
  });

  it("rejects an unauthenticated user", async () => {
    await expect(
      findOrCreateProductionProcess("", { facilityId, feedstockTypeId }),
    ).rejects.toThrow(/unauthorized/i);
  });
});
