/**
 * Real handlers, credentials and Postgres. Written for reviewer execution; never run by the implementation agent.
 *
 * Every writer outside the sample endpoints that changes `samples.credit_batch_id`
 * also bumps `samples.version`, so a sample's ETag stops matching and an old
 * If-Match is refused with the current representation (spec section 1,
 * "Versions and cascades").
 */
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { creditBatchProductionRuns, samples } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { LAB_SAMPLE_REPRESENTATION_REVISION } from "@/config/api-rest";
import { attachProductionRunToMatchingCreditBatch } from "@/data-access/credit-batch-membership";
import { createCreditBatch, deleteCreditBatch, updateCreditBatch } from "@/data-access/credit-batches";
import { createApiLabFixture, expectProblem, insertApiSample, removeApiLabFixture, type ApiLabFixture } from "./helpers/api-lab-sample-fixture";
import { labLogisticsVersion } from "./helpers/lab-logistics-version";
import { patchLabSample, readRestLabSample, seedRestLabSample } from "./helpers/api-lab-sample-write-fixture";

const TIMEOUT_MS = 60_000;
const SAMPLED_AT = "2026-09-11T08:00:00.000Z";
const CREATED_AT = "2026-10-01T10:00:00.000Z";
const LATER_WINDOW = { startDate: new Date("2026-09-10T00:00:00.000Z"), endDate: new Date("2026-09-30T00:00:00.000Z") };
/** Batch A ends before run 2 (September 11), so a second batch can claim it without overlapping. */
const EARLY_WINDOW = { startDate: "2026-09-01", endDate: "2026-09-09" };
const fixtures: ApiLabFixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await removeApiLabFixture(f); }, TIMEOUT_MS);
const etagAt = (version: number) => `"${version}.${LAB_SAMPLE_REPRESENTATION_REVISION}"`;

async function fixture(options: Parameters<typeof createApiLabFixture>[0] = {}) {
  const f = await createApiLabFixture(options);
  fixtures.push(f);
  return f;
}

/** A batch for run 2 that does not overlap batch A's early window (see `EARLY_WINDOW`). */
async function laterBatch(f: ApiLabFixture, runIds: string[]) {
  return createCreditBatch(f.ctx, {
    code: `CB-VC-${f.tag}`, facilityId: f.facility.id, feedstockTypeId: f.feedstockTypeId, ...LATER_WINDOW, productionRunIds: runIds, currency: "TZS",
  });
}

interface Cascade {
  /** Batch A's window; the default September window contains run 2, which the attach case needs. */
  window?: typeof EARLY_WINDOW;
  /** Seeds a sample, runs one outside writer, and says where the sample should point afterwards. */
  run: (f: ApiLabFixture) => Promise<{ sampleId: string; creditBatchId: string | null }>;
}

const cascades: [string, Cascade][] = [
  ["createCreditBatch linking a run's samples", { window: EARLY_WINDOW, run: async (f) => {
    const legacy = await insertApiSample(f, { code: `SAM-VC-1-${f.tag}`, creditBatchId: null, productionRunId: f.runs[1].id, samplingTime: SAMPLED_AT, createdAt: CREATED_AT });
    const batch = await laterBatch(f, [f.runs[1].id]);
    return { sampleId: legacy.id, creditBatchId: batch.id };
  } }],
  ["updateCreditBatch dropping a run from the batch", { window: EARLY_WINDOW, run: async (f) => {
    const linked = await insertApiSample(f, { code: `SAM-VC-2-${f.tag}`, creditBatchId: f.batchA.id, productionRunId: f.runs[0].id, samplingTime: SAMPLED_AT, createdAt: CREATED_AT });
    await updateCreditBatch(f.ctx, f.batchA.id, { expectedVersion: await labLogisticsVersion(f.ctx, "creditBatches", f.batchA.id), productionRunIds: [] });
    return { sampleId: linked.id, creditBatchId: null };
  } }],
  ["updateCreditBatch adding a run to the batch", { window: EARLY_WINDOW, run: async (f) => {
    await db.delete(creditBatchProductionRuns).where(and(eq(creditBatchProductionRuns.creditBatchId, f.batchA.id), eq(creditBatchProductionRuns.organizationId, f.ctx.organizationId)));
    const legacy = await insertApiSample(f, { code: `SAM-VC-3-${f.tag}`, creditBatchId: null, productionRunId: f.runs[0].id, samplingTime: SAMPLED_AT, createdAt: CREATED_AT });
    await updateCreditBatch(f.ctx, f.batchA.id, { expectedVersion: await labLogisticsVersion(f.ctx, "creditBatches", f.batchA.id), productionRunIds: [f.runs[0].id] });
    return { sampleId: legacy.id, creditBatchId: f.batchA.id };
  } }],
  ["deleteCreditBatch clearing the link", { window: EARLY_WINDOW, run: async (f) => {
    const batch = await laterBatch(f, []);
    const linked = await insertApiSample(f, { code: `SAM-VC-4-${f.tag}`, creditBatchId: batch.id, samplingTime: SAMPLED_AT, createdAt: CREATED_AT });
    await deleteCreditBatch(f.ctx, batch.id, await labLogisticsVersion(f.ctx, "creditBatches", batch.id));
    return { sampleId: linked.id, creditBatchId: null };
  } }],
  ["attaching a completed run to its matching batch", { run: async (f) => {
    const legacy = await insertApiSample(f, { code: `SAM-VC-5-${f.tag}`, creditBatchId: null, productionRunId: f.runs[1].id, samplingTime: SAMPLED_AT, createdAt: CREATED_AT });
    await db.transaction((tx) => attachProductionRunToMatchingCreditBatch(f.ctx, tx, f.runs[1].id));
    return { sampleId: legacy.id, creditBatchId: f.batchA.id };
  } }],
];

describe("lab sample version cascades", { timeout: TIMEOUT_MS }, () => {
  it.each(cascades)("%s bumps the sample version and ETag, and its old If-Match is stale", async (_name, cascade) => {
    // Run 2 stays free of any batch so the writers above can claim it.
    const f = await fixture({ withSecondBatch: false, window: cascade.window });
    const { sampleId, creditBatchId } = await cascade.run(f);
    const [row] = await db.select({ version: samples.version }).from(samples).where(and(eq(samples.id, sampleId), eq(samples.organizationId, f.ctx.organizationId)));
    const current = await readRestLabSample(f, sampleId);
    expect(current.row.creditBatchId).toBe(creditBatchId);
    expect(current.row.version).toBe(row.version);
    expect(current.row.version).toBeGreaterThan(1);
    expect(current.etag).toBe(etagAt(current.row.version));
    const stale = await expectProblem(await patchLabSample(f, sampleId, { labName: "Stale" }, etagAt(1)), 412, "stale_version");
    expect(stale.current).toEqual(current.row);
    expect((await readRestLabSample(f, sampleId)).row.labName).toBeNull();
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
