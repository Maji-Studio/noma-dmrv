/**
 * Real handlers, credentials and Postgres. Written for reviewer execution; never run by the implementation agent.
 *
 * Batch membership edits preserve sample identity; only a Sample write moves it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { deleteCreditBatch, getCreditBatchById, updateCreditBatch } from "@/data-access/credit-batches";
import { createApiLabFixture, expectProblem, insertApiSample, removeApiLabFixture, type ApiLabFixture } from "./helpers/api-lab-sample-fixture";
import { labLogisticsVersion } from "./helpers/lab-logistics-version";
import { patchLabSample, readRestLabSample, seedRestLabSample } from "./helpers/api-lab-sample-write-fixture";

const TIMEOUT_MS = 60_000;
const SAMPLED_AT = "2026-09-11T08:00:00.000Z";
const CREATED_AT = "2026-10-01T10:00:00.000Z";
const fixtures: ApiLabFixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await removeApiLabFixture(f); }, TIMEOUT_MS);

async function fixture(options: Parameters<typeof createApiLabFixture>[0] = {}) {
  const f = await createApiLabFixture(options);
  fixtures.push(f);
  return f;
}

describe("lab sample version cascades", { timeout: TIMEOUT_MS }, () => {
  it("membership edits preserve the sample's batch, version and ETag", async () => {
    const f = await fixture();
    const linked = await insertApiSample(f, { code: `SAM-VC-${f.tag}`, creditBatchId: f.batchA.id,
      productionRunId: f.runs[0].id, samplingTime: SAMPLED_AT, createdAt: CREATED_AT });
    const before = await readRestLabSample(f, linked.id);
    await updateCreditBatch(f.ctx, f.batchA.id, {
      expectedVersion: await labLogisticsVersion(f.ctx, "creditBatches", f.batchA.id), productionRunIds: [],
    });
    const after = await readRestLabSample(f, linked.id);
    expect(after.row).toEqual(before.row);
    expect(after.etag).toBe(before.etag);
  });

  it("refuses to delete a batch while it has Samples", async () => {
    const f = await fixture();
    const saved = await seedRestLabSample(f);
    await expect(deleteCreditBatch(f.ctx, f.batchA.id,
      await labLogisticsVersion(f.ctx, "creditBatches", f.batchA.id)))
      .rejects.toThrow(`Credit batch ${f.batchA.code} has Samples. Move them to another credit batch or delete them, then delete the batch.`);
    expect(await getCreditBatchById(f.ctx, f.batchA.id, { skipPreview: true })).toMatchObject({ id: f.batchA.id });
    expect((await readRestLabSample(f, saved.row.id)).row).toEqual(saved.row);
  });

  it("a sample PATCH that moves the sample bumps the version once and invalidates its own tag", async () => {
    const f = await fixture();
    const saved = await seedRestLabSample(f);
    const moved = await patchLabSample(f, saved.row.id, { creditBatchId: f.batchB!.id, samplingTime: "2026-08-10T08:00:00.000Z" }, saved.etag);
    expect(moved.status).toBe(200);
    const current = await readRestLabSample(f, saved.row.id);
    expect(current.row).toMatchObject({ version: saved.row.version + 1, creditBatchId: f.batchB!.id });
    await expectProblem(await patchLabSample(f, saved.row.id, { labName: "Again" }, saved.etag), 412, "stale_version");
  });
});
