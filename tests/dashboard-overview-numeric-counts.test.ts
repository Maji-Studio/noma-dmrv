import { beforeAll, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { productionRuns } from "@/db/schema";
import { getDashboardOverview } from "@/data-access/dashboard-overview";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";

const GROUPED_RUN_COUNT = 12;
const RUN_START_STEP_MS = 1_000;
const ctx = makeTestOrgContext();
beforeAll(() => ensureTestOrg());

it("decodes grouped UNION counts and attentionTotal as numbers", async () => {
  await withLineageFixture(async f => {
    const [source] = await db.select().from(productionRuns).where(and(
      eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.id, f.productionRunId),
    ));
    const runs = await db.insert(productionRuns).values(Array.from({ length: GROUPED_RUN_COUNT }, (_, index) => ({
      ...source, id: undefined, startTime: new Date(source.startTime.getTime() + (index + 1) * RUN_START_STEP_MS), code: `COUNT-${crypto.randomUUID()}`, feedstockMassDryKg: null,
      status: "complete" as const, endTime: new Date("2026-06-13T12:00:00Z"),
      outputPostedAt: new Date("2026-06-13T12:00:00Z"),
    }))).returning({ id: productionRuns.id });
    try {
      const result = await getDashboardOverview(ctx, f.facilityId, "all");
      const grouped = result.attention.find(item => item.id === "run-mass-group");
      expect(grouped?.count).toBe(GROUPED_RUN_COUNT);
      expect(typeof grouped?.count).toBe("number");
      expect(typeof result.attentionTotal).toBe("number");
      expect(result.attentionTotal).toBe(result.attention.reduce((total, item) => total + (item.count ?? 1), 0)
        + result.structuralGaps.reduce((total, gap) => total + gap.count, 0));
    } finally {
      await db.delete(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId), inArray(productionRuns.id, runs.map(run => run.id))));
    }
  }, "none");
});
