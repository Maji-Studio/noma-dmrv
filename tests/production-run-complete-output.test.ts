import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as MCP } from "@/app/api/mcp/route";
import { createProductionRunFn, updateProductionRunFn } from "@/fn/production-runs";
import { createProductionRunSchema, updateProductionRunSchema } from "@/schemas/production-runs";
import { rpc, rpcBody } from "./helpers/mcp";
import { createApiProductionRunFixture, removeApiFeedstockFixture, seedApiFeedstock, productionRunInput, type ApiProductionRunFixture } from "./helpers/api-feedstock-fixture";
import { captureProductionRunState, completionPatch, postProductionRun, patchProductionRun, seedApiProductionRun, readProductionRun } from "./helpers/api-production-run-fixture";

const auth = vi.hoisted(() => ({ requireOrgContext: vi.fn() }));
vi.mock("@/lib/auth/server", async (original) => ({
  ...await original<typeof import("@/lib/auth/server")>(), requireOrgContext: auth.requireOrgContext,
}));
const TIMEOUT_MS = 30_000;
const EDITED_OUTPUT_MOISTURE_PERCENT = 10;
const TRANSPORTS = ["action", "rest", "mcp"] as const;
const REQUIREMENTS = [
  { field: "biocharStorageLocationId", message: "Select a biochar output bin for a complete run." },
  { field: "biocharMoisturePercent", message: "Enter biochar moisture for a complete run." },
] as const;
let fixture: ApiProductionRunFixture;
beforeEach(async () => {
  fixture = await createApiProductionRunFixture("complete-output");
  await seedApiFeedstock(fixture);
  auth.requireOrgContext.mockResolvedValue(fixture.ctx);
});
afterEach(async () => { await removeApiFeedstockFixture(fixture); auth.requireOrgContext.mockReset(); });

describe.each(TRANSPORTS)("complete output through %s", (transport) => {
  async function refuse(body: Record<string, unknown>, requirement: typeof REQUIREMENTS[number], saved?: Awaited<ReturnType<typeof seedApiProductionRun>>) {
    const target = saved ? { productionRunId: saved.row.id, expectedVersion: saved.row.version } : {};
    if (transport === "action") {
      const input = { ...body, ...target, ...(typeof body.startTime === "string" ? { startTime: new Date(body.startTime) } : {}),
        ...(typeof body.endTime === "string" ? { endTime: new Date(body.endTime) } : {}) };
      const result = saved
        ? await updateProductionRunFn(updateProductionRunSchema.parse(input))
        : await createProductionRunFn({ ...createProductionRunSchema.parse({
          ...input, startDate: new Date("2026-10-06T00:00:00Z"),
          biocharStorageLocationId: fixture.outputBinId, biocharMoisturePercent: 0,
        }), [requirement.field]: body[requirement.field] });
      expect(result).toMatchObject({ success: false, code: "validation_failed", issues: [
        expect.objectContaining({ path: [requirement.field], message: requirement.message }),
      ] });
    } else if (transport === "rest") {
      const response = saved
        ? await patchProductionRun(fixture, saved.row, saved.etag, body)
        : await postProductionRun(fixture, body);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "validation_failed", errors: [
        expect.objectContaining({ pointer: `/${requirement.field}`, detail: requirement.message }),
      ] });
    } else {
      const { result } = await rpcBody(await MCP(rpc(fixture.key, "tools/call", {
        name: saved ? "update_production_run" : "start_production_run",
        arguments: { ...body, ...target, requestKey: randomUUID() },
      })));
      expect(result).toMatchObject({ isError: true, structuredContent: { code: "validation_failed", issues: [
        expect.objectContaining({ pointer: `/${requirement.field}`, detail: requirement.message }),
      ] } });
    }
  }

  it.each(REQUIREMENTS)("refuses complete creation without $field and leaves stock unchanged", async (requirement) => {
    const baseline = await captureProductionRunState(fixture);
    for (const missing of [undefined, null]) {
      await refuse({ ...productionRunInput(fixture), ...completionPatch(fixture), [requirement.field]: missing }, requirement);
      expect(await captureProductionRunState(fixture)).toEqual(baseline);
    }
  }, TIMEOUT_MS);

  it.each(REQUIREMENTS)("refuses completion and clearing $field, but keeps omitted saved output", async (requirement) => {
    const running = await seedApiProductionRun(fixture);
    const baseline = await captureProductionRunState(fixture);
    await refuse({ ...completionPatch(fixture), [requirement.field]: undefined }, requirement, running);
    expect(await captureProductionRunState(fixture)).toEqual(baseline);
    const completed = await patchProductionRun(fixture, running.row, running.etag, { ...completionPatch(fixture), biocharMoisturePercent: 0 });
    expect(completed.status).toBe(200);
    const saved = await readProductionRun(fixture, running.row.id);
    const completeState = await captureProductionRunState(fixture);
    await refuse({ [requirement.field]: null }, requirement, saved);
    expect(await captureProductionRunState(fixture)).toEqual(completeState);
    const edited = await patchProductionRun(fixture, saved.row, saved.etag, { electricityKwh: 0 });
    expect(edited.status).toBe(200);
    expect((await edited.json()).data).toMatchObject({ status: "complete", biocharStorageLocationId: fixture.outputBinId, biocharMoisturePercent: 0 });
  }, TIMEOUT_MS);
});

it.each(["running", "complete"] as const)("dates output posted by %s creation and subsequent transitions", async (status) => {
  const saved = await seedApiProductionRun(fixture, {
    ...productionRunInput(fixture), ...(status === "complete" ? completionPatch(fixture) : {}),
  });
  const stored = async () => (await captureProductionRunState(fixture)).runs.find(run => run.id === saved.row.id)!;
  if (status === "running") {
    expect((await stored()).outputPostedAt).toBeNull();
    const response = await patchProductionRun(fixture, saved.row, saved.etag, completionPatch(fixture));
    expect(response.status).toBe(200);
  }
  const postedAt = (await stored()).outputPostedAt;
  expect(postedAt).toBeInstanceOf(Date);
  const complete = await readProductionRun(fixture, saved.row.id);
  // Runs have no note field; energy is an unrelated editable run field.
  const edited = await patchProductionRun(fixture, complete.row, complete.etag, { electricityKwh: 12 });
  expect(edited.status).toBe(200);
  expect((await stored()).outputPostedAt).toEqual(postedAt);
  // This run has no downstream stock observations, products or locked lineage.
  const beforeOutputEdit = await readProductionRun(fixture, saved.row.id);
  const outputEdited = await patchProductionRun(fixture, beforeOutputEdit.row, beforeOutputEdit.etag, {
    biocharMoisturePercent: EDITED_OUTPUT_MOISTURE_PERCENT,
  });
  expect(outputEdited.status).toBe(200);
  const outputPostedAt = (await stored()).outputPostedAt;
  expect(outputPostedAt!.getTime()).toBeGreaterThan(postedAt!.getTime());
  const beforeRepeat = await readProductionRun(fixture, saved.row.id);
  const repeated = await patchProductionRun(fixture, beforeRepeat.row, beforeRepeat.etag, {
    ...completionPatch(fixture), biocharMoisturePercent: EDITED_OUTPUT_MOISTURE_PERCENT,
  });
  expect(repeated.status).toBe(200);
  expect((await stored()).outputPostedAt).toEqual(outputPostedAt);
  const current = await readProductionRun(fixture, saved.row.id);
  const reopened = await patchProductionRun(fixture, current.row, current.etag, { status: "running", endTime: null });
  expect(reopened.status).toBe(200);
  expect((await stored()).outputPostedAt).toBeNull();
  const open = await readProductionRun(fixture, saved.row.id);
  const recompleted = await patchProductionRun(fixture, open.row, open.etag, completionPatch(fixture));
  expect(recompleted.status).toBe(200);
  expect((await stored()).outputPostedAt!.getTime()).toBeGreaterThanOrEqual(postedAt!.getTime());
}, TIMEOUT_MS);
