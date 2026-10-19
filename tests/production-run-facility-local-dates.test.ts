import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { productionRuns } from "@/db/schema";
import { productionRunDateExpr } from "@/data-access/production-runs/date-expr";
import { getProductionRuns } from "@/data-access/production-runs/queries";
import { getProductionRunsEntity } from "@/data-access/entities/production-runs";
import { getDashboardOverview } from "@/data-access/dashboard-overview";
import { formatDate } from "@/lib/format-utils";
import { facilityCalendarFixture } from "./helpers/facility-calendar-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";

const ENTITY_LIMIT = 20;
const ISO_MONTH_LENGTH = 7;
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
