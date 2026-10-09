import { productionRunEtag } from "@/lib/api/representation-etags";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apiAuditEvents, productionRuns } from "@/db/schema";
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { POST as MCP } from "@/app/api/mcp/route";
import { GET as RUNS, POST } from "@/app/api/v1/production-runs/route";
import { GET, PATCH, DELETE } from "@/app/api/v1/production-runs/[idOrCode]/route";
import { GET as REACTORS } from "@/app/api/v1/reactors/route";
import {
  createApiProductionRunFixture, removeApiFeedstockFixture, seedApiFeedstock, binWetStock,
  productionRunInput, productionRunRequest, type ApiProductionRunFixture,
} from "./helpers/api-feedstock-fixture";
import { rpc, rpcBody } from "./helpers/mcp";

const TIMEOUT_MS = 30_000;
let a: ApiProductionRunFixture;
let b: ApiProductionRunFixture;
beforeEach(async () => {
  a = await createApiProductionRunFixture(`mcp-run-a-${randomUUID()}`);
  b = await createApiProductionRunFixture(`mcp-run-b-${randomUUID()}`);
  await seedApiFeedstock(a);
  await seedApiFeedstock(b);
});
afterEach(async () => { await removeApiFeedstockFixture(a); await removeApiFeedstockFixture(b); });
async function call(name: string, args: Record<string, unknown> = {}, key = a.key) {
  const response = await MCP(rpc(key, "tools/call", { name, arguments: args }));
  expect(response.status).toBe(200);
  return (await rpcBody(response)).result;
}
const params = (idOrCode: string) => ({ params: Promise.resolve({ idOrCode }) });
const request = (method: string, path = "", body?: unknown, headers: Record<string, string> = {}) => productionRunRequest(a, method, path, body, headers);
const rows = () => db.select().from(productionRuns).where(eq(productionRuns.organizationId, a.ctx.organizationId));

const toolNames = ["start_production_run", "update_production_run", "delete_production_run", "find_reactors", "find_production_runs", "get_production_run"];
describe("production MCP tools", { timeout: TIMEOUT_MS }, () => {
  it("reports duplicate codes with the same conflict and pointer as REST", async () => {
    const first = (await call("start_production_run", { ...productionRunInput(a), requestKey: randomUUID() })).structuredContent.data;
    const second = (await call("start_production_run", { ...productionRunInput(a, false), status: "cancelled",
      cancellationReason: "Not started", endTime: "2026-10-06T11:00:00Z", requestKey: randomUUID() })).structuredContent.data;
    const refused = await call("update_production_run", { productionRunId: second.id, expectedVersion: second.version,
      code: first.code, requestKey: randomUUID() });
    expect(refused).toMatchObject({ isError: true, structuredContent: { code: "conflict",
      issues: [expect.objectContaining({ pointer: "/code", code: "conflict" })] } });
    expect(await rows()).toEqual(expect.arrayContaining([expect.objectContaining({ id: second.id, code: second.code, version: 1 })]));
  });

  it("accepts numeric form encodings on create and update without clearing omissions", async () => {
    const created = await call("start_production_run", { ...productionRunInput(a), electricityKwh: "12.5",
      residenceTimeMinutes: "12", feedstockMoisturePercent: "20",
      feedstockDraws: [{ storageLocationId: a.binId, wetMassKg: "1200" }], requestKey: randomUUID() });
    const row = created.structuredContent.data;
    expect(row).toMatchObject({ electricityKwh: 12.5, residenceTimeMinutes: 12 });
    const changed = await call("update_production_run", { productionRunId: row.id, expectedVersion: row.version,
      electricityKwh: "", dieselOperationLiters: "0", feedingRateKgHr: "12.5",
      feedstockDraws: [{ storageLocationId: a.binId, wetMassKg: "600" }], requestKey: randomUUID() });
    expect(changed.structuredContent.data).toMatchObject({ electricityKwh: null, dieselOperationLiters: 0,
      feedingRateKgHr: 12.5, residenceTimeMinutes: 12, feedstockMoisturePercent: 20 });
    expect(await rows()).toMatchObject([{ electricityKwh: null, dieselOperationLiters: 0, feedstockWetMassKg: 600, residenceTimeMinutes: 12 }]);
    expect(await binWetStock(a)).toBe(3600);
  });

  it("registers all six tools with scopes and destructive annotations", async () => {
    const { result } = await rpcBody(await MCP(rpc(a.key, "tools/list")));
    for (const name of toolNames) expect(result.tools).toContainEqual(expect.objectContaining({ name }));
    for (const name of ["update_production_run", "delete_production_run"]) {
      expect(result.tools.find((tool: { name: string }) => tool.name === name).annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    }
    const key = (await createApiKey(a.ctx, { name: "Run reader", scopes: ["production-runs:read"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key;
    const visible = (await rpcBody(await MCP(rpc(key, "tools/list")))).result.tools.map((tool: { name: string }) => tool.name);
    expect(visible).toContain("find_production_runs");
    expect(visible).toContain("get_production_run");
    for (const name of ["start_production_run", "update_production_run", "delete_production_run", "find_reactors"]) expect(visible).not.toContain(name);
    const writer = (await createApiKey(a.ctx, { name: "Run writer", scopes: ["production-runs:write"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key;
    expect((await rpcBody(await MCP(rpc(writer, "tools/list")))).result.tools.map((tool: { name: string }) => tool.name)).not.toContain("delete_production_run");
  });

  it("replays a REST create over MCP with one run, draw, stock deduction and audit", async () => {
    const key = randomUUID();
    const rest = await POST(request("POST", "", productionRunInput(a), { "idempotency-key": key }));
    expect(rest.status).toBe(201);
    const body = await rest.json();
    const result = await call("start_production_run", { ...productionRunInput(a), requestKey: key });
    expect(result.structuredContent).toEqual(body);
    expect(result.content[0].text).toMatch(/^Replayed: Started production run/);
    expect(await rows()).toHaveLength(1);
    expect(await binWetStock(a)).toBe(3000);
    expect(await db.select().from(apiAuditEvents).where(eq(apiAuditEvents.organizationId, a.ctx.organizationId)))
      .toMatchObject([{ transport: "rest" }, { transport: "rest" }]);
  });

  it("starts, reads, updates and deletes with REST envelopes and versions", async () => {
    const started = await call("start_production_run", { ...productionRunInput(a), requestKey: randomUUID() });
    expect(started.isError).toBeUndefined();
    const row = started.structuredContent.data;
    for (const idOrCode of [row.id, row.code]) {
      const rest = await GET(request("GET", `/${idOrCode}`), params(idOrCode));
      expect((await call("get_production_run", { idOrCode })).structuredContent).toEqual(await rest.json());
    }
    const list = await RUNS(request("GET", `?reactorId=${a.reactorId}&status=running`));
    expect((await call("find_production_runs", { reactorId: a.reactorId, status: "running" })).structuredContent).toEqual(await list.json());
    expect((await call("find_production_runs", { q: row.code.toLowerCase() })).structuredContent.data).toEqual([row]);
    for (const q of ["%", "_", "\\"]) {
      expect((await call("find_production_runs", { q })).structuredContent.data).toEqual([]);
    }
    const reactors = await REACTORS(new Request(`http://localhost:3100/api/v1/reactors?facilityId=${a.facilityId}`, { headers: { authorization: `Bearer ${a.key}` } }));
    expect((await call("find_reactors", { facilityId: a.facilityId })).structuredContent).toEqual(await reactors.json());
    const updated = await call("update_production_run", { productionRunId: row.id, expectedVersion: row.version, electricityKwh: 0, requestKey: randomUUID() });
    expect(updated.structuredContent.data).toMatchObject({ code: row.code, version: 2, electricityKwh: 0 });
    const stale = await call("update_production_run", { productionRunId: row.id, expectedVersion: row.version, requestKey: randomUUID() });
    expect(stale).toMatchObject({ isError: true, structuredContent: { code: "stale_version", current: updated.structuredContent.data } });
    const deleted = await call("delete_production_run", { productionRunId: row.id, expectedVersion: 2, requestKey: randomUUID() });
    expect(deleted.structuredContent).toEqual({ deleted: { id: row.id, code: row.code } });
    expect(await rows()).toHaveLength(0);
    expect(await binWetStock(a)).toBe(4200);
  });

  it.each(["update", "delete"] as const)("replays REST %s over MCP before the original precondition is checked", async (kind) => {
    const created = await call("start_production_run", { ...productionRunInput(a), requestKey: randomUUID() });
    const row = created.structuredContent.data;
    const key = randomUUID();
    const rest = await (kind === "update" ? PATCH : DELETE)(request(kind === "update" ? "PATCH" : "DELETE", `/${row.id}`,
      kind === "update" ? { electricityKwh: 12 } : undefined, { "if-match": productionRunEtag(row), "idempotency-key": key }), params(row.id));
    expect(rest.status).toBe(kind === "update" ? 200 : 204);
    const replay = await call(`${kind}_production_run`, { productionRunId: row.id, expectedVersion: 1, requestKey: key,
      ...(kind === "update" ? { electricityKwh: 12 } : {}) });
    expect(replay.content[0].text).toMatch(/^Replayed:/);
    expect(replay.structuredContent).toEqual(kind === "update" ? await rest.json() : { deleted: { id: row.id, code: row.code } });
  });

  it("requires requestKey for each write and allows key-free stock previews", async () => {
    const createArgs = productionRunInput(a);
    expect(await call("start_production_run", createArgs)).toMatchObject({ isError: true, structuredContent: { code: "idempotency_key_required" } });
    const preview = await call("start_production_run", { ...createArgs, dryRun: true });
    expect(preview.structuredContent.stockEffects).toMatchObject([{ before: { wetKg: 4200 }, after: { wetKg: 3000 } }]);
    expect(await rows()).toHaveLength(0);
    const created = await call("start_production_run", { ...createArgs, requestKey: randomUUID() });
    for (const kind of ["update", "delete"]) {
      const args = { productionRunId: created.structuredContent.data.id, expectedVersion: 1, ...(kind === "update" ? { feedstockDraws: [] } : {}) };
      expect(await call(`${kind}_production_run`, args)).toMatchObject({ isError: true, structuredContent: { code: "idempotency_key_required" } });
      expect((await call(`${kind}_production_run`, { ...args, dryRun: true })).structuredContent.stockEffects)
        .toMatchObject([{ before: { wetKg: 3000 }, after: { wetKg: 4200 } }]);
      expect(await binWetStock(a)).toBe(3000);
      expect(await rows()).toMatchObject([{ version: 1 }]);
    }
  });

  it("refuses foreign path, body and filter IDs and binds cursors to the organization", async () => {
    const foreign = (await call("start_production_run", { ...productionRunInput(b), requestKey: randomUUID() }, b.key)).structuredContent.data;
    for (const [name, args] of [
      ["get_production_run", { idOrCode: foreign.id }],
      ["update_production_run", { productionRunId: foreign.id, expectedVersion: 1, requestKey: randomUUID() }],
      ["delete_production_run", { productionRunId: foreign.id, expectedVersion: 1, requestKey: randomUUID() }],
      ["start_production_run", { ...productionRunInput(a), reactorId: b.reactorId, requestKey: randomUUID() }],
      ["start_production_run", { ...productionRunInput(a), feedstockDraws: [{ storageLocationId: b.binId, wetMassKg: 1200 }], requestKey: randomUUID() }],
      ["find_production_runs", { reactorId: b.reactorId }], ["find_reactors", { facilityId: b.facilityId }],
    ] as const) {
      const refusal = await call(name, args);
      expect(refusal).toMatchObject({ isError: true, structuredContent: { code: "not_found" } });
      expect(JSON.stringify(refusal)).not.toContain(foreign.code);
    }
    expect(await rows()).toHaveLength(0);
    expect(await binWetStock(a)).toBe(4200);
    await call("start_production_run", { ...productionRunInput(a), requestKey: randomUUID() });
    await call("start_production_run", { ...productionRunInput(a, false), status: "cancelled", cancellationReason: "Not started", endTime: "2026-10-06T11:00:00Z", requestKey: randomUUID() });
    const cursor = (await call("find_production_runs", { limit: 1 })).structuredContent.nextCursor;
    expect(await call("find_production_runs", { cursor }, b.key)).toMatchObject({ isError: true, structuredContent: { code: "invalid_cursor" } });
  });
});
