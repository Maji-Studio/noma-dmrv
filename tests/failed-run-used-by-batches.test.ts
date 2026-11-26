import { beforeAll, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { productionRunFeedstocks } from "@/db/schema";
import { getRecordUsedByChain } from "@/data-access/record-used-by-chain";
import { withFailedRunLineage } from "./helpers/failed-run-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";

const ctx = makeTestOrgContext();
beforeAll(() => ensureTestOrg());

it("marks a failed production run's batch as emissions only", async () => {
  await withFailedRunLineage(async (f, run) => {
    const chain = await getRecordUsedByChain(ctx, "productionRun", run.id);
    expect(chain!.creditBatches).toEqual([expect.objectContaining({ id: f.batchId, dependency: "production-emissions" })]);
  }, "none");
});

it("marks an intake reached only through a failed run as emissions only", async () => {
  await withFailedRunLineage(async f => {
    await db.delete(productionRunFeedstocks).where(and(
      eq(productionRunFeedstocks.organizationId, ctx.organizationId),
      eq(productionRunFeedstocks.productionRunId, f.productionRunId),
      eq(productionRunFeedstocks.feedstockId, f.feedstockId),
    ));
    const chain = await getRecordUsedByChain(ctx, "feedstock", f.feedstockId);
    expect(chain!.creditBatches).toEqual([expect.objectContaining({ id: f.batchId, dependency: "production-emissions" })]);
  }, "none");
});

it("keeps a batch reached through both material and failed runs unmarked", async () => {
  await withFailedRunLineage(async f => {
    const chain = await getRecordUsedByChain(ctx, "feedstock", f.feedstockId);
    expect(chain!.creditBatches.map(batch => batch.id)).toEqual([f.batchId]);
    expect(chain!.creditBatches[0].dependency).toBeUndefined();
  }, "none");
});
