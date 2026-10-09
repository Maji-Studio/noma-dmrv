/** Real actions, REST, MCP and Postgres. Not run, needs the supervisor. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as MCP } from "@/app/api/mcp/route";
import { createProductionRunFn, updateProductionRunFn, deleteProductionRunFn } from "@/fn/production-runs";
import { rpc, rpcBody } from "./helpers/mcp";
import { createApiProductionRunFixture, removeApiFeedstockFixture, seedApiFeedstock, productionRunInput, type ApiProductionRunFixture } from "./helpers/api-feedstock-fixture";
import {
  captureProductionRunState, restoreProductionRunState, postProductionRun, patchProductionRun, deleteProductionRun,
  readProductionRun, completionPatch, cancellationPatch, productionRunAudits, RUN_INTAKE_WET_KG,
  RUN_DRAW_WET_KG, RUN_OUTPUT_WET_KG, RUN_OUTPUT_DRY_KG, INITIAL_RUN_VERSION, NEXT_RUN_VERSION,
} from "./helpers/api-production-run-fixture";

const auth = vi.hoisted(() => ({ requireOrgContext: vi.fn() }));
vi.mock("@/lib/auth/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/server")>(), requireOrgContext: auth.requireOrgContext,
}));
const TIMEOUT_MS = 30_000;
const TRANSPORTS = ["action", "rest", "mcp"] as const;
type Transport = typeof TRANSPORTS[number];
let fixture: ApiProductionRunFixture;
let feedstockId: string;
beforeEach(async () => {
  fixture = await createApiProductionRunFixture("run-parity");
  feedstockId = (await seedApiFeedstock(fixture, RUN_INTAKE_WET_KG)).row.id;
  auth.requireOrgContext.mockResolvedValue(fixture.ctx);
});
afterEach(async () => { await removeApiFeedstockFixture(fixture); auth.requireOrgContext.mockReset(); });

async function mcp(name: string, args: object) {
  const { result } = await rpcBody(await MCP(rpc(fixture.key, "tools/call", { name, arguments: { ...args, requestKey: randomUUID() } })));
  expect(result.isError).not.toBe(true);
  return result.structuredContent;
}
async function create(transport: Transport) {
  const input = productionRunInput(fixture);
  if (transport === "action") {
    const result = await createProductionRunFn({ ...input, startTime: new Date(input.startTime), startDate: new Date("2026-10-06T00:00:00Z"), endTime: undefined });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(`Create refused: ${result.code}`);
    return readProductionRun(fixture, result.data.id);
  }
  if (transport === "mcp") return readProductionRun(fixture, (await mcp("start_production_run", input)).data.id);
  const response = await postProductionRun(fixture, input);
  expect(response.status).toBe(201);
  return readProductionRun(fixture, (await response.json()).data.id);
}
async function update(transport: Transport, saved: Awaited<ReturnType<typeof create>>, patch: ReturnType<typeof completionPatch> | typeof cancellationPatch) {
  const target = { productionRunId: saved.row.id, expectedVersion: saved.row.version };
  if (transport === "action") {
    expect(await updateProductionRunFn({ ...target, ...patch, endTime: new Date(patch.endTime) })).toMatchObject({ success: true, data: { version: NEXT_RUN_VERSION } });
  } else if (transport === "mcp") {
    expect((await mcp("update_production_run", { ...target, ...patch })).data).toMatchObject({ version: NEXT_RUN_VERSION });
  } else {
    const response = await patchProductionRun(fixture, saved.row, saved.etag, patch);
    expect(response.status).toBe(200);
    expect((await response.json()).data.version).toBe(NEXT_RUN_VERSION);
  }
  return readProductionRun(fixture, saved.row.id);
}
async function remove(transport: Transport, saved: Awaited<ReturnType<typeof create>>) {
  const target = { productionRunId: saved.row.id, expectedVersion: saved.row.version };
  if (transport === "action") expect(await deleteProductionRunFn(target)).toEqual({ success: true, data: undefined });
  else if (transport === "mcp") expect((await mcp("delete_production_run", target)).deleted).toEqual({ id: saved.row.id, code: saved.row.code });
  else expect((await deleteProductionRun(fixture, saved.row, saved.etag)).status).toBe(204);
}
function normalize(state: Awaited<ReturnType<typeof captureProductionRunState>>) {
  return {
    ...state,
    runs: state.runs.map(({ id, code, createdAt, updatedAt, stockPostingSequence, ...row }) => {
      expect(id).toBeTruthy(); expect(code).toMatch(/^PR-\d{2}-\d{3,}$/);
      expect(createdAt).toBeInstanceOf(Date); expect(updatedAt).toBeInstanceOf(Date);
      expect(stockPostingSequence).toBeGreaterThan(BigInt(0));
      return row;
    }),
    draws: state.draws.map(({ id, productionRunId, createdAt, ...draw }) => {
      expect(id).toBeTruthy(); expect(productionRunId).toBeTruthy(); expect(createdAt).toBeInstanceOf(Date);
      return draw;
    }),
    allocations: state.allocations.map(({ id, productionRunId, createdAt, ...allocation }) => {
      expect(id).toBeTruthy(); expect(productionRunId).toBeTruthy(); expect(createdAt).toBeInstanceOf(Date);
      return allocation;
    }),
  };
}
function assertState(state: Awaited<ReturnType<typeof captureProductionRunState>>, status: "running" | "complete" | "cancelled" | "deleted") {
  const deleted = status === "deleted";
  expect(state.runs).toHaveLength(deleted ? 0 : 1);
  expect(state.draws).toHaveLength(deleted ? 0 : 1);
  expect(state.allocations).toHaveLength(deleted ? 0 : 1);
  if (!deleted) {
    expect(state.runs[0]).toMatchObject({ status, reactorId: fixture.reactorId, facilityId: fixture.facilityId,
      version: status === "running" ? INITIAL_RUN_VERSION : NEXT_RUN_VERSION, feedstockWetMassKg: RUN_DRAW_WET_KG,
      biocharOutputKg: status === "complete" ? RUN_OUTPUT_WET_KG : null,
      biocharDryMassKg: status === "complete" ? RUN_OUTPUT_DRY_KG : null });
    expect(state.draws[0]).toMatchObject({ productionRunId: state.runs[0].id, storageLocationId: fixture.binId, wetMassKg: RUN_DRAW_WET_KG });
    expect(state.allocations[0]).toMatchObject({ productionRunId: state.runs[0].id, feedstockId, wetMassUsedKg: RUN_DRAW_WET_KG });
  }
  expect(state.wetStock).toBe(status === "running" || status === "complete" ? RUN_INTAKE_WET_KG - RUN_DRAW_WET_KG : RUN_INTAKE_WET_KG);
  expect(state.outputStock).toMatchObject({ allLayersDryKg: status === "complete" ? RUN_OUTPUT_DRY_KG : 0,
    availableDryKg: status === "complete" ? RUN_OUTPUT_DRY_KG : 0 });
}

describe("production run three-way parity", { timeout: TIMEOUT_MS }, () => {
  it.each(["complete", "cancelled"] as const)("creates, changes status to %s and deletes with equal rows, stock, versions and audit effects", async (status) => {
    const baseline = await captureProductionRunState(fixture);
    const states: ReturnType<typeof normalize>[][] = [];
    const auditEffects: object[][] = [];
    for (const transport of TRANSPORTS) {
      await restoreProductionRunState(fixture, baseline);
      const created = await create(transport);
      expect(created.row.version).toBe(INITIAL_RUN_VERSION);
      const afterCreate = await captureProductionRunState(fixture);
      assertState(afterCreate, "running");
      const updated = await update(transport, created, status === "complete" ? completionPatch(fixture) : cancellationPatch);
      expect(updated.etag).not.toBe(created.etag);
      const afterUpdate = await captureProductionRunState(fixture);
      assertState(afterUpdate, status);
      await remove(transport, updated);
      const afterDelete = await captureProductionRunState(fixture);
      assertState(afterDelete, "deleted");
      states.push([afterCreate, afterUpdate, afterDelete].map(normalize));
      const audits = await productionRunAudits(fixture);
      if (transport === "action") expect(audits).toEqual([]); // Decision 27: API audit only.
      else {
        expect(audits).toHaveLength(3);
        for (const audit of audits) {
          expect(audit.transport).toBe(transport);
          expect(audit.entityIds).toEqual([created.row.id]);
          expect(audit.credentialId).toBe(fixture.credentialId);
        }
      }
      auditEffects.push(audits.map(({ operationId, outcomeCode, versionBefore, versionAfter, changedFields }) =>
        ({ operationId, outcomeCode, versionBefore, versionAfter, changedFields })).sort((a, b) => a.operationId.localeCompare(b.operationId)));
    }
    expect(states[1]).toEqual(states[0]);
    expect(states[2]).toEqual(states[0]);
    expect(auditEffects[2]).toEqual(auditEffects[1]);
    expect(auditEffects[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ operationId: "start_production_run", outcomeCode: "created", versionBefore: null, versionAfter: INITIAL_RUN_VERSION }),
      expect.objectContaining({ operationId: "update_production_run", outcomeCode: "updated", versionBefore: INITIAL_RUN_VERSION, versionAfter: NEXT_RUN_VERSION }),
      expect.objectContaining({ operationId: "delete_production_run", outcomeCode: "deleted", versionBefore: NEXT_RUN_VERSION, versionAfter: null }),
    ]));
  });
});
