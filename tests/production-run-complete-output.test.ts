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
