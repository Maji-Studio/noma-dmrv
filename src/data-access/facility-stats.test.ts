import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { facilities, reactors, storageLocations } from "@/db/schema";
import { cleanupCatalogueStatsOrg, seedCatalogueStatsOrg } from "../../tests/helpers/catalogue-stats-fixture";
import { TEST_SITE_POSITION } from "../../tests/helpers/test-org";
import { getFacilities } from "./facilities";
import { getFacilityStats } from "./facility-stats";

const FACILITY_COUNT = 25;
const PAGE_SIZE = 10;
const BINS_PER_TYPE = 2;
const STORAGE_BIN_TYPES = ["feedstock_bin", "biochar_bin", "product_bin"] as const;
const FIXTURE_DATE = new Date("2026-09-12T12:00:00Z");
type Fixture = Awaited<ReturnType<typeof seedCatalogueStatsOrg>>;

describe("getFacilityStats whole-list totals", () => {
  let fixture: Fixture;
  let foreign: Fixture;

  beforeAll(async () => {
    fixture = await seedCatalogueStatsOrg();
    foreign = await seedCatalogueStatsOrg();
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
    await db.insert(storageLocations).values(sites.flatMap((site) => STORAGE_BIN_TYPES.flatMap((type) => [
      { organizationId: site.organizationId, facilityId: site.id, code: `${site.code}-${type}`, name: `${site.code}-${type}`, type },
      { organizationId: site.organizationId, facilityId: site.id, code: `${site.code}-${type}-ARCHIVED`, name: `${site.code}-${type}-ARCHIVED`, type, archivedAt: FIXTURE_DATE },
    ])));
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
    };
    expect(await getFacilityStats(fixture.ctx)).toEqual(expected);
    for (const page of [1, 2]) {
      const list = await getFacilities(fixture.ctx, { page, pageSize: PAGE_SIZE });
      expect(list.items).toHaveLength(PAGE_SIZE);
      expect(list.total).toBe(FACILITY_COUNT);
      expect(list.items.every((item) => item.storageLocationCount === STORAGE_BIN_TYPES.length * BINS_PER_TYPE)).toBe(true);
      expect(await getFacilityStats(fixture.ctx)).toEqual(expected);
    }
    const searched = await getFacilities(fixture.ctx, { page: 1, pageSize: PAGE_SIZE, search: `E2E-STATS-${fixture.tag}-0` });
    expect(searched.items).toHaveLength(1);
    expect(await getFacilityStats(fixture.ctx)).toEqual(expected);
    expect(await getFacilityStats(fixture.ctx, { archived: false })).toEqual(expected);
  });

  it("selects only archived facilities with the same child rules and excludes foreign rows", async () => {
    expect(await getFacilityStats(fixture.ctx, { archived: true })).toEqual({
      totalFacilities: 1, totalReactors: 1, totalStorageBins: STORAGE_BIN_TYPES.length * BINS_PER_TYPE,
    });
    expect((await getFacilities(fixture.ctx, { archived: true })).total).toBe(1);
    expect(await getFacilityStats(foreign.ctx)).toEqual({
      totalFacilities: 1, totalReactors: 1, totalStorageBins: STORAGE_BIN_TYPES.length * BINS_PER_TYPE,
    });
  });

  it("rejects a missing organization scope", async () => {
    await expect(getFacilityStats({ ...fixture.ctx, organizationId: "" })).rejects.toThrow();
  });
});
