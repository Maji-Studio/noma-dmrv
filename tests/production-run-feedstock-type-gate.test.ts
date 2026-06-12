import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { createProductionRun } from "@/data-access/production-runs";
import { getEntities } from "@/data-access/entities";
import { facilities, reactors, storageLocations } from "@/db/schema/facilities";
import { feedstocks, feedstockTypes } from "@/db/schema/feedstock";
import { productionRuns, productionRunFeedstocks } from "@/db/schema/production";

const TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000001";

describe("createProductionRun — feedstock type usage gate", () => {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
  let facilityId: string;
  let reactorId: string;
  let pyrolysisTypeId: string;
  let blendTypeId: string;
  let pyrolysisBinId: string;
  let blendBinId: string;
  const createdRunIds: string[] = [];
  const createdFeedstockIds: string[] = [];

  beforeAll(async () => {
    const [facility] = await db
      .insert(facilities)
      .values({ code: `FAC-PRG-${tag}`, name: `PRG Facility ${tag}` })
      .returning({ id: facilities.id });
    facilityId = facility.id;

    const [reactor] = await db
      .insert(reactors)
      .values({
        code: `R-PRG-${tag}`,
        identifier: `PRG Reactor ${tag}`,
        facilityId,
        reactorType: "auger",
      })
      .returning({ id: reactors.id });
    reactorId = reactor.id;

    const [pyrolysisType] = await db
      .insert(feedstockTypes)
      .values({
        code: `FT-PRG-P-${tag}`,
        name: `PRG Pyrolysis ${tag}`,
        category: "forestry",
        usage: "pyrolysis",
      })
      .returning({ id: feedstockTypes.id });
    pyrolysisTypeId = pyrolysisType.id;

    const [blendType] = await db
      .insert(feedstockTypes)
      .values({
        code: `FT-PRG-B-${tag}`,
        name: `PRG Blend ${tag}`,
        category: "ingredient",
        usage: "blend",
      })
      .returning({ id: feedstockTypes.id });
    blendTypeId = blendType.id;

    const insertedBins = await db
      .insert(storageLocations)
      .values([
        {
          code: `BIN-PRG-P-${tag}`,
          name: `PRG Pyrolysis Bin ${tag}`,
          type: "feedstock_bin",
          facilityId,
          feedstockTypeId: pyrolysisTypeId,
        },
        {
          code: `BIN-PRG-B-${tag}`,
          name: `PRG Blend Bin ${tag}`,
          type: "feedstock_bin",
          facilityId,
          feedstockTypeId: blendTypeId,
        },
      ])
      .returning({ id: storageLocations.id, code: storageLocations.code });

    pyrolysisBinId = insertedBins.find((bin) => bin.code.startsWith("BIN-PRG-P"))!.id;
    blendBinId = insertedBins.find((bin) => bin.code.startsWith("BIN-PRG-B"))!.id;

    const insertedFeedstocks = await db
      .insert(feedstocks)
      .values([
        {
          code: `FS-PRG-P-${tag}`,
          facilityId,
          status: "complete",
          feedstockTypeId: pyrolysisTypeId,
          massDryKg: 100,
          massWetKg: 125,
          moistureContentPercent: 20,
          storageLocationId: pyrolysisBinId,
        },
        {
          code: `FS-PRG-B-${tag}`,
          facilityId,
          status: "complete",
          feedstockTypeId: blendTypeId,
          massDryKg: 100,
          massWetKg: 125,
          moistureContentPercent: 20,
          storageLocationId: blendBinId,
        },
      ])
      .returning({ id: feedstocks.id });
    createdFeedstockIds.push(...insertedFeedstocks.map((feedstock) => feedstock.id));
  });

  afterAll(async () => {
    async function cleanup(step: () => Promise<unknown>) {
      try {
        await step();
      } catch {
        // Best-effort teardown; preserve the original assertion failure.
      }
    }

    if (createdRunIds.length > 0) {
      await cleanup(() =>
        db
          .delete(productionRunFeedstocks)
          .where(inArray(productionRunFeedstocks.productionRunId, createdRunIds)),
      );
      await cleanup(() =>
        db.delete(productionRuns).where(inArray(productionRuns.id, createdRunIds)),
      );
    }
    if (createdFeedstockIds.length > 0) {
      await cleanup(() =>
        db.delete(feedstocks).where(inArray(feedstocks.id, createdFeedstockIds)),
      );
    }
    if (pyrolysisBinId || blendBinId) {
      await cleanup(() =>
        db
          .delete(storageLocations)
          .where(inArray(storageLocations.id, [pyrolysisBinId, blendBinId].filter(Boolean))),
      );
    }
    if (pyrolysisTypeId || blendTypeId) {
      await cleanup(() =>
        db
          .delete(feedstockTypes)
          .where(inArray(feedstockTypes.id, [pyrolysisTypeId, blendTypeId].filter(Boolean))),
      );
    }
    if (reactorId) {
      await cleanup(() => db.delete(reactors).where(eq(reactors.id, reactorId)));
    }
    if (facilityId) {
      await cleanup(() => db.delete(facilities).where(eq(facilities.id, facilityId)));
    }
  });

  function baseRunInput(codeSuffix: string, feedstockStorageLocationId: string) {
    const startTime = new Date("2026-01-15T08:00:00Z");
    return {
      code: `PR-PRG-${codeSuffix}-${tag}`,
      facilityId,
      reactorId,
      date: startTime,
      startTime,
      endTime: new Date("2026-01-15T10:00:00Z"),
      feedstockWetMassKg: 50,
      feedstockMoisturePercent: 20,
      feedstockStorageLocationId,
    };
  }

  it("allows a source bin holding pyrolysis-usage feedstock", async () => {
    const run = await createProductionRun(
      TEST_USER_ID,
      baseRunInput("ALLOW", pyrolysisBinId),
    );
    createdRunIds.push(run.id);

    expect(run.feedstockStorageLocationId).toBe(pyrolysisBinId);
  });

  it("rejects a source bin holding blend-usage feedstock", async () => {
    await expect(
      createProductionRun(TEST_USER_ID, baseRunInput("REJECT", blendBinId)),
    ).rejects.toThrow("Source bin holds a blend feedstock type");
  });

  it("returns only pyrolysis-usage source bins for production-run pickers", async () => {
    const options = await getEntities(TEST_USER_ID, {
      entityType: "storageLocation",
      filterBy: {
        facilityId,
        type: "feedstock_bin",
        feedstockTypeUsage: "pyrolysis",
      },
      limit: 20,
    });

    expect(options.map((option) => option.id)).toContain(pyrolysisBinId);
    expect(options.map((option) => option.id)).not.toContain(blendBinId);
    expect(options.find((option) => option.id === pyrolysisBinId)?.subtitle).toContain(
      "PRG Pyrolysis",
    );
    expect(options.find((option) => option.id === pyrolysisBinId)?.subtitle).toContain(
      "(Pyrolysis)",
    );
  });
});
