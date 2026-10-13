import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { biocharProducts, formulations, productionRuns } from "@/db/schema";
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
afterEach(async () => {
  await db.delete(biocharProducts).where(eq(biocharProducts.organizationId, fixture.ctx.organizationId));
  await db.delete(formulations).where(eq(formulations.organizationId, fixture.ctx.organizationId));
  await removeApiFeedstockFixture(fixture);
  auth.requireOrgContext.mockReset();
});

describe.each(TRANSPORTS)("complete output through %s", (transport) => {
  it.each(REQUIREMENTS)("allows metadata edits on a legacy complete run missing $field with a dependent product", async ({ field }) => {
    const complete = await seedApiProductionRun(fixture, { ...productionRunInput(fixture), ...completionPatch(fixture) });
    await db.update(productionRuns).set({ [field]: null }).where(and(
      eq(productionRuns.organizationId, fixture.ctx.organizationId), eq(productionRuns.id, complete.row.id),
    ));
    const [formulation] = await db.insert(formulations).values({
      organizationId: fixture.ctx.organizationId, code: "E2E-LEGACY-PURE", name: "E2E Legacy pure", biocharRatio: 1,
    }).returning();
    await db.insert(biocharProducts).values({
      organizationId: fixture.ctx.organizationId, facilityId: fixture.facilityId,
      code: "E2E-LEGACY-PRODUCT", formulationId: formulation.id,
      placedAt: new Date(complete.row.endTime!), linkedProductionRunId: complete.row.id,
    });
    const baseline = await captureProductionRunState(fixture);
    for (const status of [undefined, "complete"] as const) {
      const saved = await readProductionRun(fixture, complete.row.id);
      const patch = { electricityKwh: 0, status };
      if (transport === "action") {
        expect(await updateProductionRunFn({
          productionRunId: saved.row.id, expectedVersion: saved.row.version, ...patch,
        })).toMatchObject({ success: true });
      } else if (transport === "rest") {
        expect((await patchProductionRun(fixture, saved.row, saved.etag, patch)).status).toBe(200);
      } else {
        const { result } = await rpcBody(await MCP(rpc(fixture.key, "tools/call", {
          name: "update_production_run", arguments: {
            productionRunId: saved.row.id, expectedVersion: saved.row.version, requestKey: randomUUID(), ...patch,
          },
        })));
        expect(result.isError).not.toBe(true);
      }
      const after = await captureProductionRunState(fixture);
      expect(after.runs[0]).toMatchObject({ status: "complete", [field]: null, electricityKwh: 0, version: saved.row.version + 1 });
      expect({ ...after, runs: [] }).toEqual({ ...baseline, runs: [] });
    }
  }, TIMEOUT_MS);

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
