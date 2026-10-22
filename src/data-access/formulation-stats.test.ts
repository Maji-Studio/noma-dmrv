import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { formulations } from "@/db/schema";
import { cleanupCatalogueStatsOrg, seedCatalogueStatsOrg } from "../../tests/helpers/catalogue-stats-fixture";
import { getFormulations } from "./formulations";
import { getFormulationStats } from "./formulation-stats";

const ROW_COUNT = 25;
const PAGE_SIZE = 10;
const FIXTURE_DATE = new Date("2026-09-12T12:00:00Z");
type Fixture = Awaited<ReturnType<typeof seedCatalogueStatsOrg>>;

describe("getFormulationStats whole-list totals", () => {
  let fixture: Fixture;
  let foreign: Fixture;

  beforeAll(async () => {
    fixture = await seedCatalogueStatsOrg();
    foreign = await seedCatalogueStatsOrg();
    const values = (owner: Fixture, code: string) => ({
      organizationId: owner.ctx.organizationId,
      code,
      name: code,
    });
    // org-scope-ok: fixture values helper sets organizationId
    await db.insert(formulations).values([
      ...Array.from({ length: ROW_COUNT }, (_, index) => values(fixture, `E2E-STATS-${fixture.tag}-${index}`)),
      { ...values(fixture, `E2E-ARCHIVED-${fixture.tag}`), archivedAt: FIXTURE_DATE },
      values(foreign, `E2E-FOREIGN-${foreign.tag}`),
      { ...values(foreign, `E2E-FOREIGN-ARCHIVED-${foreign.tag}`), archivedAt: FIXTURE_DATE },
    ]);
  });

  afterAll(async () => {
    if (foreign) await cleanupCatalogueStatsOrg(foreign.ctx.organizationId);
    if (fixture) await cleanupCatalogueStatsOrg(fixture.ctx.organizationId);
  });

  it("counts every active row independently of pagination and search, excluding the other organization", async () => {
    const expected = { totalFormulations: ROW_COUNT };
    expect(await getFormulationStats(fixture.ctx)).toEqual(expected);
    for (const page of [1, 2]) {
      const list = await getFormulations(fixture.ctx, { page, pageSize: PAGE_SIZE });
      expect(list.items).toHaveLength(PAGE_SIZE);
      expect(list.total).toBe(ROW_COUNT);
      expect(await getFormulationStats(fixture.ctx)).toEqual(expected);
    }
    const searched = await getFormulations(fixture.ctx, { page: 1, pageSize: PAGE_SIZE, search: `E2E-STATS-${fixture.tag}-0` });
    expect(searched.items).toHaveLength(1);
    expect(await getFormulationStats(fixture.ctx)).toEqual(expected);
    expect(await getFormulationStats(fixture.ctx, { archived: false })).toEqual(expected);
  });

  it("counts only archived rows when toggled and still excludes foreign rows", async () => {
    expect(await getFormulationStats(fixture.ctx, { archived: true })).toEqual({ totalFormulations: 1 });
    expect((await getFormulations(fixture.ctx, { archived: true })).total).toBe(1);
    expect(await getFormulationStats(foreign.ctx)).toEqual({ totalFormulations: 1 });
  });

  it("rejects a missing organization scope", async () => {
    await expect(getFormulationStats({ ...fixture.ctx, organizationId: "" })).rejects.toThrow();
  });
});
