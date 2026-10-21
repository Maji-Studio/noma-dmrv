import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { facilities, feedstocks, feedstockTypes, reactors, storageLocations } from "@/db/schema";
import { cleanupCatalogueStatsOrg, seedCatalogueStatsOrg } from "../../tests/helpers/catalogue-stats-fixture";
import { feedstockFixtureValues } from "../../tests/helpers/feedstock-fixture";
import { TEST_SITE_POSITION } from "../../tests/helpers/test-org";
import { getFacilities } from "./facilities";
import { getFacilityStats } from "./facility-stats";

const FACILITY_COUNT = 25;
const PAGE_SIZE = 10;
const BINS_PER_TYPE = 2;
const FEEDSTOCK_WET_KG_STEP = 100;
const FEEDSTOCK_MOISTURE_PERCENT = 20;
const PERCENT = 100;
const ARCHIVED_FEEDSTOCK_WET_KG_PER_BIN = 9_000;
const FOREIGN_FEEDSTOCK_WET_KG_PER_BIN = 50_000;
const FOREIGN_ARCHIVED_FEEDSTOCK_WET_KG_PER_BIN = 60_000;
const TOTAL_ACTIVE_FEEDSTOCK_WET_KG = Array.from(
  { length: FACILITY_COUNT },
  (_, index) => (index + 1) * FEEDSTOCK_WET_KG_STEP * BINS_PER_TYPE,
).reduce((sum, mass) => sum + mass, 0);
const STORAGE_BIN_TYPES = ["feedstock_bin", "biochar_bin", "product_bin"] as const;
const FIXTURE_DATE = new Date("2026-09-12T12:00:00Z");
type Fixture = Awaited<ReturnType<typeof seedCatalogueStatsOrg>>;

describe("getFacilityStats whole-list totals", () => {
  let fixture: Fixture;
  let foreign: Fixture;

  beforeAll(async () => {
    fixture = await seedCatalogueStatsOrg();
    foreign = await seedCatalogueStatsOrg();
    const types = await db.insert(feedstockTypes).values([fixture, foreign].map((owner) => ({
      organizationId: owner.ctx.organizationId, code: `E2E-TYPE-${owner.tag}`,
      name: `E2E Type ${owner.tag}`, category: "forestry" as const, usage: "pyrolysis" as const,
    }))).returning();
    const typeIdByOrg = new Map(types.map((type) => [type.organizationId, type.id]));
    const values = (owner: Fixture, code: string) => ({
      ...TEST_SITE_POSITION, timezone: "UTC", organizationId: owner.ctx.organizationId, code, name: code,
    });
    // org-scope-ok: fixture values helper sets organizationId
    const sites = await db.insert(facilities).values([
      ...Array.from({ length: FACILITY_COUNT }, (_, index) => values(fixture, `E2E-STATS-${fixture.tag}-${index}`)),
      { ...values(fixture, `E2E-ARCHIVED-${fixture.tag}`), archivedAt: FIXTURE_DATE },
      values(foreign, `E2E-FOREIGN-${foreign.tag}`),
      { ...values(foreign, `E2E-FOREIGN-ARCHIVED-${foreign.tag}`), archivedAt: FIXTURE_DATE },
    ]).returning();
    await db.insert(reactors).values(sites.flatMap((site) => [
      { organizationId: site.organizationId, facilityId: site.id, code: `${site.code}-ACTIVE`, identifier: `${site.code}-ACTIVE`, reactorType: "auger" as const },
      { organizationId: site.organizationId, facilityId: site.id, code: `${site.code}-ARCHIVED`, identifier: `${site.code}-ARCHIVED`, reactorType: "auger" as const, archivedAt: FIXTURE_DATE },
    ]));
    // Multiple child rows catch accidental join multiplication. Bin archive
    // state is intentionally unfiltered, matching getFacilities.
    const bins = await db.insert(storageLocations).values(sites.flatMap((site) => STORAGE_BIN_TYPES.flatMap((type) => {
      const values = {
        organizationId: site.organizationId, facilityId: site.id, type,
        feedstockTypeId: type === "feedstock_bin" ? typeIdByOrg.get(site.organizationId) : null,
      };
      return [
        { ...values, code: `${site.code}-${type}`, name: `${site.code}-${type}` },
        { ...values, code: `${site.code}-${type}-ARCHIVED`, name: `${site.code}-${type}-ARCHIVED`, archivedAt: FIXTURE_DATE },
      ];
    }))).returning();
    const wetKgByFacility = new Map(sites.map((site, index) => [
      site.id,
      site.organizationId === foreign.ctx.organizationId
        ? (site.archivedAt ? FOREIGN_ARCHIVED_FEEDSTOCK_WET_KG_PER_BIN : FOREIGN_FEEDSTOCK_WET_KG_PER_BIN)
        : (site.archivedAt ? ARCHIVED_FEEDSTOCK_WET_KG_PER_BIN : (index + 1) * FEEDSTOCK_WET_KG_STEP),
    ]));
    for (const bin of bins.filter((bin) => bin.type === "feedstock_bin")) {
      const massWetKg = wetKgByFacility.get(bin.facilityId)!;
      await db.insert(feedstocks).values(await feedstockFixtureValues(db, {
        organizationId: bin.organizationId, facilityId: bin.facilityId, storageLocationId: bin.id,
        feedstockTypeId: bin.feedstockTypeId!, code: `${bin.code}-INTAKE`, status: "complete",
        massWetKg, massDryKg: massWetKg * (1 - FEEDSTOCK_MOISTURE_PERCENT / PERCENT),
        moistureContentPercent: FEEDSTOCK_MOISTURE_PERCENT, deliveryDate: FIXTURE_DATE,
      }));
    }
  });

  afterAll(async () => {
    if (foreign) await cleanupCatalogueStatsOrg(foreign.ctx.organizationId);
    if (fixture) await cleanupCatalogueStatsOrg(fixture.ctx.organizationId);
  });

  it("counts every active facility and its children independently of pagination and search", async () => {
    const expected = {
      totalFacilities: FACILITY_COUNT,
      totalReactors: FACILITY_COUNT,
      totalStorageBins: FACILITY_COUNT * STORAGE_BIN_TYPES.length * BINS_PER_TYPE,
      totalFeedstockWetKg: TOTAL_ACTIVE_FEEDSTOCK_WET_KG,
    };
    expect(await getFacilityStats(fixture.ctx)).toEqual(expected);
    let totalFeedstockWetKg = 0;
    const pageCount = Math.ceil(FACILITY_COUNT / PAGE_SIZE);
    for (let page = 1; page <= pageCount; page++) {
      const list = await getFacilities(fixture.ctx, { page, pageSize: PAGE_SIZE });
      expect(list.items).toHaveLength(Math.min(PAGE_SIZE, FACILITY_COUNT - (page - 1) * PAGE_SIZE));
      expect(list.total).toBe(FACILITY_COUNT);
      expect(list.items.every((item) => item.storageLocationCount === STORAGE_BIN_TYPES.length * BINS_PER_TYPE)).toBe(true);
      totalFeedstockWetKg += list.items.reduce((sum, item) => sum + item.inventorySummary.feedstockWetKg, 0);
      expect(await getFacilityStats(fixture.ctx)).toEqual(expected);
    }
    expect(totalFeedstockWetKg).toBe(TOTAL_ACTIVE_FEEDSTOCK_WET_KG);
    expect((await getFacilityStats(fixture.ctx)).totalFeedstockWetKg).toBe(totalFeedstockWetKg);
    const searched = await getFacilities(fixture.ctx, { page: 1, pageSize: PAGE_SIZE, search: `E2E-STATS-${fixture.tag}-0` });
    expect(searched.items).toHaveLength(1);
    expect(searched.items[0].inventorySummary.feedstockWetKg).toBe(FEEDSTOCK_WET_KG_STEP * BINS_PER_TYPE);
    expect(await getFacilityStats(fixture.ctx)).toEqual(expected);
    expect(await getFacilityStats(fixture.ctx, { archived: false })).toEqual(expected);
  });

  it("selects only archived facilities with the same child rules and excludes foreign rows", async () => {
    expect(await getFacilityStats(fixture.ctx, { archived: true })).toEqual({
      totalFacilities: 1, totalReactors: 1, totalStorageBins: STORAGE_BIN_TYPES.length * BINS_PER_TYPE,
      totalFeedstockWetKg: ARCHIVED_FEEDSTOCK_WET_KG_PER_BIN * BINS_PER_TYPE,
    });
    const archived = await getFacilities(fixture.ctx, { archived: true });
    expect(archived.total).toBe(1);
    expect((await getFacilityStats(fixture.ctx, { archived: true })).totalFeedstockWetKg).toBe(
      archived.items.reduce((sum, item) => sum + item.inventorySummary.feedstockWetKg, 0),
    );
    expect(await getFacilityStats(foreign.ctx)).toEqual({
      totalFacilities: 1, totalReactors: 1, totalStorageBins: STORAGE_BIN_TYPES.length * BINS_PER_TYPE,
      totalFeedstockWetKg: FOREIGN_FEEDSTOCK_WET_KG_PER_BIN * BINS_PER_TYPE,
    });
    expect((await getFacilityStats(foreign.ctx, { archived: true })).totalFeedstockWetKg).toBe(
      FOREIGN_ARCHIVED_FEEDSTOCK_WET_KG_PER_BIN * BINS_PER_TYPE,
    );
  });

  it("rejects a missing organization scope", async () => {
    await expect(getFacilityStats({ ...fixture.ctx, organizationId: "" })).rejects.toThrow();
  });
});
