import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { productionRuns } from "@/db/schema";
import { findFailedEmissionCohortRunIds } from "@/data-access/credit-batch-failed-cohort";
import { lockCreditBatchDeclarationRuns, lockCreditBatchForUpdate, prepareCreditBatchMembershipWrite } from "@/data-access/credit-batch-membership";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";
import { failedRunFixture } from "./helpers/failed-run-fixture";

const ROLLBACK = new Error("rollback failed cohort fixture");
const ctx = makeTestOrgContext();
beforeAll(() => ensureTestOrg());

describe("failed emission cohort write locks", () => {
  it("locks failed candidates without returning them as material members", async () => {
    await expect(db.transaction(async tx => {
      const f = await failedRunFixture(tx, { batch: false });
      expect(await findFailedEmissionCohortRunIds(ctx, tx, f.batchValues)).toEqual([f.run.id]);
      const declaration = await lockCreditBatchDeclarationRuns(ctx, tx, {
        ...f.batchValues, certifier: null, requestedProductionRunIds: [],
      });
      expect(declaration.runIds).toEqual([]);
      expect(declaration.lockedRuns).toEqual([]);
      expect(await findFailedEmissionCohortRunIds({ ...ctx, organizationId: crypto.randomUUID() }, tx, f.batchValues)).toEqual([]);
      throw ROLLBACK;
    })).rejects.toBe(ROLLBACK);
  });

  it("detects old failed contributor drift after preparation", async () => {
    await expect(db.transaction(async tx => {
      const f = await failedRunFixture(tx);
      const prepared = await prepareCreditBatchMembershipWrite(ctx, tx, f.batch!.id);
      expect(prepared.currentFailedRunIds).toEqual([f.run.id]);
      await tx.update(productionRuns).set({ endTime: new Date("2026-04-01T12:00:00Z") }).where(and(
        eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.id, f.run.id),
      ));
      await expect(lockCreditBatchForUpdate(ctx, tx, f.batch!.id, {
        expectedVersion: f.batch!.version,
      }, prepared)).rejects.toMatchObject({ code: "conflict" });
      throw ROLLBACK;
    })).rejects.toBe(ROLLBACK);
  });
});
