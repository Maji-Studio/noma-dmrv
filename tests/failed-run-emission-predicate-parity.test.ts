import { beforeAll, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches, feedstocks, feedstockTypes, productionProcesses, productionRunFeedstocks, productionRuns } from "@/db/schema";
import { failedRunEmissionBatchCondition } from "@/data-access/failed-run-emission-predicate";
import { findFailedEmissionCohortRunIds } from "@/data-access/credit-batch-failed-cohort";
import { loadBatchEmissionContributors, loadRunEmissionContributors } from "@/data-access/credit-batch-emission-contributors";
import { failedRunFixture } from "./helpers/failed-run-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";

const ctx = makeTestOrgContext();
const ROLLBACK = new Error("rollback predicate parity");
beforeAll(() => ensureTestOrg());

it.each(["attached", "no-match", "mixed", "empty", "archived-run", "archived-batch", "timezone-boundary"])(
  "keeps SQL, prospective cohorts and the TypeScript reference in agreement for %s", async scenario => {
    await expect(db.transaction(async tx => {
      const f = await failedRunFixture(tx, scenario === "timezone-boundary"
        ? { timezone: "Africa/Dar_es_Salaam", endTime: "2026-02-28T22:00:00Z" } : {});
      // Other-type batches share the same window and facility.
      const otherTypes = [];
      for (const index of [1, 2]) {
        const [type] = await tx.insert(feedstockTypes).values({ ...f.type, id: undefined,
          code: `PARITY-${index}-${crypto.randomUUID()}`, name: `Parity type ${crypto.randomUUID()}` }).returning();
        otherTypes.push(type);
        const [process] = await tx.insert(productionProcesses).values({ ...f.site, feedstockTypeId: type.id }).returning();
        await tx.insert(creditBatches).values({ ...f.batchValues, code: `PARITY-CB-${crypto.randomUUID()}`,
          feedstockTypeId: type.id, productionProcessId: process.id });
      }
      if (scenario === "no-match") await tx.update(productionRuns).set({ endTime: new Date("2026-04-02") }).where(eq(productionRuns.id, f.run.id));
      if (scenario === "archived-run") await tx.update(productionRuns).set({ archivedAt: new Date() }).where(eq(productionRuns.id, f.run.id));
      if (scenario === "archived-batch") await tx.update(creditBatches).set({ archivedAt: new Date() }).where(eq(creditBatches.id, f.batch!.id));
      if (scenario === "empty") await tx.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, f.run.id));
      if (scenario === "mixed") {
        const [stock] = await tx.insert(feedstocks).values({ ...f.stock, id: undefined,
          code: `PARITY-STOCK-${crypto.randomUUID()}`, feedstockTypeId: otherTypes[0].id }).returning();
        await tx.insert(productionRunFeedstocks).values({ ...f.org, productionRunId: f.run.id, feedstockId: stock.id, wetMassUsedKg: 1 });
      }
      const [run] = await tx.select().from(productionRuns).where(eq(productionRuns.id, f.run.id));
      const batches = await tx.select().from(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, f.facility.id)));
      const draws = await tx.select({ typeId: feedstocks.feedstockTypeId }).from(productionRunFeedstocks)
        .innerJoin(feedstocks, eq(feedstocks.id, productionRunFeedstocks.feedstockId))
        .where(eq(productionRunFeedstocks.productionRunId, run.id));
      const types = new Set(draws.map(draw => draw.typeId));
      // Independent TS oracle: retain the old matching rule here, not in production.
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: f.facility.timezone,
        year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(run.endTime!);
      const part = (kind: string) => parts.find(value => value.type === kind)!.value;
      const day = `${part("year")}-${part("month")}-${part("day")}`;
      for (const includeArchived of [false, true]) {
        const expected = batches.filter(batch => (includeArchived || (!run.archivedAt && !batch.archivedAt)) &&
          types.size === 1 && types.has(batch.feedstockTypeId) && batch.startDate <= day && day <= batch.endDate).map(batch => batch.id).sort();
        const sqlMatches = await tx.select({ id: creditBatches.id }).from(productionRuns)
          .innerJoin(creditBatches, failedRunEmissionBatchCondition(ctx)).where(and(
            eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.id, run.id),
            includeArchived ? undefined : isNull(productionRuns.archivedAt),
            includeArchived ? undefined : isNull(creditBatches.archivedAt),
          ));
        expect(sqlMatches.map(batch => batch.id).sort()).toEqual(expected);
        const resolved = await loadRunEmissionContributors(ctx, [run.id], tx, { includeArchived });
        expect(resolved.flatMap(row => row.creditBatchId ? [row.creditBatchId] : [])).toEqual(expected);
        const loaded = await loadBatchEmissionContributors(ctx, batches.map(batch => batch.id), tx, { includeArchived });
        expect(Object.entries(loaded).filter(([, value]) => value.failedContributors.some(row => row.runId === run.id)).map(([id]) => id).sort()).toEqual(expected);
      }
      // A prospective window deliberately ignores the saved batch's archive state.
      for (const batch of batches) {
        const expected = !run.archivedAt && types.size === 1 && types.has(batch.feedstockTypeId) && batch.startDate <= day && day <= batch.endDate;
        expect(await findFailedEmissionCohortRunIds(ctx, tx, batch)).toEqual(expected ? [run.id] : []);
      }
      throw ROLLBACK;
    })).rejects.toBe(ROLLBACK);
  },
);
