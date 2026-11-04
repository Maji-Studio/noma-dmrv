import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { facilities, reactors } from "@/db/schema";
import { cleanupCatalogueStatsOrg, seedCatalogueStatsOrg } from "../../tests/helpers/catalogue-stats-fixture";
import { TEST_SITE_POSITION } from "../../tests/helpers/test-org";
import { getReactors } from "./reactors";
import { getReactorStats } from "./reactor-stats";

const REACTOR_COUNT = 25;
const PAGE_SIZE = 10;
const THROUGHPUT_TPH = 1000.1;
const TENTHS = 10;
const TOTAL_THROUGHPUT_TPH = Math.round(REACTOR_COUNT * THROUGHPUT_TPH * TENTHS) / TENTHS;
const FIXTURE_DATE = new Date("2026-09-12T12:00:00Z");
type Fixture = Awaited<ReturnType<typeof seedCatalogueStatsOrg>>;

describe("getReactorStats whole-list totals", () => {
  let fixture: Fixture;
  let foreign: Fixture;
  let facilityId: string;
  let nullFacilityId: string;
  let emptyFacilityId: string;

  beforeAll(async () => {
    fixture = await seedCatalogueStatsOrg();
    foreign = await seedCatalogueStatsOrg();
    const facilityValues = (owner: Fixture, code: string) => ({
      ...TEST_SITE_POSITION, timezone: "UTC", organizationId: owner.ctx.organizationId, code, name: code,
    });
    // org-scope-ok: fixture values helper sets organizationId
    const [site, nullSite, emptySite, foreignSite] = await db.insert(facilities).values([
      facilityValues(fixture, `E2E-STATS-${fixture.tag}`),
      facilityValues(fixture, `E2E-NULL-${fixture.tag}`),
      facilityValues(fixture, `E2E-EMPTY-${fixture.tag}`),
      facilityValues(foreign, `E2E-FOREIGN-${foreign.tag}`),
    ]).returning();
    facilityId = site.id;
    nullFacilityId = nullSite.id;
    emptyFacilityId = emptySite.id;
    const values = (owner: Fixture, siteId: string, code: string) => ({
      organizationId: owner.ctx.organizationId,
      facilityId: siteId, code, identifier: code, reactorType: "auger" as const,
      nominalThroughputTph: THROUGHPUT_TPH,
    });
    // org-scope-ok: fixture values helper sets organizationId
    await db.insert(reactors).values([
      ...Array.from({ length: REACTOR_COUNT }, (_, index) => values(fixture, facilityId, `E2E-STATS-${fixture.tag}-${index}`)),
      { ...values(fixture, facilityId, `E2E-ARCHIVED-${fixture.tag}`), archivedAt: FIXTURE_DATE },
      { ...values(fixture, nullFacilityId, `E2E-NULL-${fixture.tag}`), nominalThroughputTph: null },
      values(foreign, foreignSite.id, `E2E-FOREIGN-${foreign.tag}`),
    ]);
  });

  afterAll(async () => {
    if (foreign) await cleanupCatalogueStatsOrg(foreign.ctx.organizationId);
    if (fixture) await cleanupCatalogueStatsOrg(fixture.ctx.organizationId);
  });

  it("sums all active facility reactors as numeric independently of pagination and search", async () => {
    const scope = { facilityId };
    const expected = { totalReactors: REACTOR_COUNT, totalNominalThroughputTph: TOTAL_THROUGHPUT_TPH };
    expect(await getReactorStats(fixture.ctx, scope)).toEqual(expected);
    for (const page of [1, 2]) {
      const list = await getReactors(fixture.ctx, { ...scope, page, pageSize: PAGE_SIZE });
      expect(list.items).toHaveLength(PAGE_SIZE);
      expect(list.total).toBe(REACTOR_COUNT);
      expect(await getReactorStats(fixture.ctx, scope)).toEqual(expected);
    }
    const searched = await getReactors(fixture.ctx, { ...scope, page: 1, pageSize: PAGE_SIZE, search: `E2E-STATS-${fixture.tag}-0` });
    expect(searched.items).toHaveLength(1);
    expect(await getReactorStats(fixture.ctx, scope)).toEqual(expected);
  });

  it("scopes organization totals and rejects foreign facility rows", async () => {
    expect(await getReactorStats(fixture.ctx)).toEqual({ totalReactors: REACTOR_COUNT + 1, totalNominalThroughputTph: TOTAL_THROUGHPUT_TPH });
    expect(await getReactorStats(foreign.ctx, { facilityId })).toEqual({ totalReactors: 0, totalNominalThroughputTph: null });
    expect(await getReactorStats(foreign.ctx)).toEqual({ totalReactors: 1, totalNominalThroughputTph: THROUGHPUT_TPH });
  });

  it("preserves null for an all-null or empty facility", async () => {
    expect(await getReactorStats(fixture.ctx, { facilityId: nullFacilityId })).toEqual({ totalReactors: 1, totalNominalThroughputTph: null });
    expect(await getReactorStats(fixture.ctx, { facilityId: emptyFacilityId })).toEqual({ totalReactors: 0, totalNominalThroughputTph: null });
  });

  it("rejects a missing organization scope", async () => {
    await expect(getReactorStats({ ...fixture.ctx, organizationId: "" })).rejects.toThrow();
  });
});
