import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { productionRuns } from "@/db/schema";
import { productionRunDateExpr } from "@/data-access/production-runs/date-expr";
import { getProductionRuns } from "@/data-access/production-runs/queries";
import { getProductionRunsEntity } from "@/data-access/entities/production-runs";
import { getDashboardOverview } from "@/data-access/dashboard-overview";
import { formatDate } from "@/lib/format-utils";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import { addDaysIso } from "@/lib/date-utils";
import { facilityCalendarFixture } from "./helpers/facility-calendar-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";

const ENTITY_LIMIT = 20;
const ISO_MONTH_LENGTH = 7;
const FEEDSTOCK_DRY_KG = 1000;
const BIOCHAR_DRY_KG = 200;
const DASHBOARD_NOW = "2025-09-30T22:30:00.000Z";
const WEEK_DAYS = 7;
const WEEK_FIXTURE_START_DAY = "2025-09-17";
const WEEK_FIXTURE_END_DAY = "2025-10-02";
const CASES = [
  { label: "DAR", zone: "Africa/Dar_es_Salaam", start: "2025-09-30T22:00:00.000Z", day: "2025-10-01" },
  { label: "LA", zone: "America/Los_Angeles", start: "2025-10-01T06:00:00.000Z", day: "2025-09-30" },
];

describe("production run facility-local display dates", () => {
  const f = facilityCalendarFixture("LOCAL-DATES");
  const ctx = makeTestOrgContext();
  const rows: { id: string; code: string; facilityId: string; day: string }[] = [];
  beforeAll(async () => {
    await ensureTestOrg();
    for (const c of CASES) {
      const facility = await f.facility(c.label, c.zone);
      const run = await f.run(facility.id, c.label, c.start);
      rows.push({ ...run, day: c.day });
    }
  });
  afterAll(() => f.cleanup());

  it.each(["all", "week", "month"] as const)("counts measured Dar es Salaam runs before UTC midnight (%s)", async (range) => {
    const facility = await f.facility(`KPI-${range}`, "Africa/Dar_es_Salaam");
    const run = await f.run(facility.id, `KPI-${range}`, "2025-09-30T22:00:00.000Z");
    await db.update(productionRuns).set({
      endTime: new Date("2025-09-30T22:15:00.000Z"),
      feedstockMassDryKg: FEEDSTOCK_DRY_KG,
      biocharDryMassKg: BIOCHAR_DRY_KG,
    }).where(and(eq(productionRuns.id, run.id), eq(productionRuns.organizationId, ctx.organizationId)));

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(DASHBOARD_NOW));
    try {
      const dashboard = await getDashboardOverview(ctx, facility.id, range);
      expect(dashboard.kpis).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: "feedstockProcessed", value: kgToTonnes(FEEDSTOCK_DRY_KG), detail: "dry mass into 1 run" }),
        expect.objectContaining({ key: "biocharProduced", value: kgToTonnes(BIOCHAR_DRY_KG) }),
      ]));
      expect(dashboard.massFlow).toEqual(expect.arrayContaining([
        { key: "intoRuns", tonnes: kgToTonnes(FEEDSTOCK_DRY_KG) },
        { key: "produced", tonnes: kgToTonnes(BIOCHAR_DRY_KG) },
      ]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("compares exactly seven local days of measured runs in each week", async () => {
    const facility = await f.facility("KPI-WEEK-BOUNDS", "Africa/Dar_es_Salaam");
    const runIds: string[] = [];
    // Previous: Sep 18-24. Current: Sep 25-Oct 1. Include both outer neighbors.
    for (let day = WEEK_FIXTURE_START_DAY; day <= WEEK_FIXTURE_END_DAY; day = addDaysIso(day, 1)) {
      const run = await f.run(facility.id, `WEEK-${day}`, `${day}T00:00:00+03:00`);
      runIds.push(run.id);
    }
    await db.update(productionRuns).set({
      feedstockMassDryKg: FEEDSTOCK_DRY_KG,
      biocharDryMassKg: BIOCHAR_DRY_KG,
    }).where(and(
      eq(productionRuns.organizationId, ctx.organizationId),
      inArray(productionRuns.id, runIds),
    ));

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(DASHBOARD_NOW));
    try {
      const dashboard = await getDashboardOverview(ctx, facility.id, "week");
      // Equal per-day masses and zero deltas also require seven previous runs.
      expect(dashboard.kpis).toEqual(expect.arrayContaining([
        expect.objectContaining({
          key: "feedstockProcessed",
          value: kgToTonnes(FEEDSTOCK_DRY_KG * WEEK_DAYS),
          detail: `dry mass into ${WEEK_DAYS} runs`,
          deltaPercent: 0,
        }),
        expect.objectContaining({
          key: "biocharProduced",
          value: kgToTonnes(BIOCHAR_DRY_KG * WEEK_DAYS),
          deltaPercent: 0,
        }),
      ]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("selects the facility's start day directly and in the paginated list", async () => {
    const ids = rows.map((row) => row.id);
    const dates = await db.select({ id: productionRuns.id, date: productionRunDateExpr(ctx.organizationId) })
      .from(productionRuns).where(and(
        eq(productionRuns.organizationId, ctx.organizationId), inArray(productionRuns.id, ids),
      ));
    const list = await getProductionRuns(ctx, { ids });
    for (const row of rows) {
      expect(dates).toContainEqual({ id: row.id, date: row.day });
      expect(list.items).toContainEqual(expect.objectContaining({ id: row.id, date: row.day }));
    }
  });

  it.each([
    { start: "2025-10-01", end: "2025-10-31", day: "2025-10-01" },
    { start: "2025-09-01", end: "2025-09-30", day: "2025-09-30" },
  ])("filters the inclusive local range $start to $end", async ({ start, end, day }) => {
    const list = await getProductionRuns(ctx, {
      ids: rows.map((row) => row.id),
      startDate: new Date(`${start}T12:00:00`), endDate: new Date(`${end}T12:00:00`),
    });
    expect(list.items.map((row) => row.id)).toEqual(rows.filter((row) => row.day === day).map((row) => row.id));
    expect(list.total).toBe(1);
  });

  it("uses the local start day for entity labels, date search and dashboard attention", async () => {
    for (const row of rows) {
      const params = { facilityId: row.facilityId, limit: ENTITY_LIMIT };
      expect(await getProductionRunsEntity(ctx, params)).toContainEqual(
        expect.objectContaining({ id: row.id, name: formatDate(row.day) }),
      );
      expect((await getProductionRunsEntity(ctx, { ...params, search: row.day })).map((r) => r.id)).toEqual([row.id]);
      const otherDay = rows.find((other) => other.id !== row.id)!.day;
      expect(await getProductionRunsEntity(ctx, { ...params, search: otherDay })).toEqual([]);
      expect((await getProductionRunsEntity(ctx, { ...params, search: row.day.slice(0, ISO_MONTH_LENGTH) })).map((r) => r.id)).toEqual([row.id]);
      expect((await getProductionRunsEntity(ctx, { ...params, search: row.code })).map((r) => r.id)).toEqual([row.id]);
      const dashboard = await getDashboardOverview(ctx, row.facilityId, "all");
      expect(dashboard.attention).toContainEqual(expect.objectContaining({ entityCode: row.code, date: row.day }));
    }
  });
});
