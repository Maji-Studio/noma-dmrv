/** Real MCP route, credentials and Postgres. Written for reviewer execution; never run by the implementation agent. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches } from "@/db/schema";
import { POST as MCP } from "@/app/api/mcp/route";
import { GET as GET_LIST } from "@/app/api/v1/lab-samples/route";
import { GET as GET_ONE } from "@/app/api/v1/lab-samples/[idOrCode]/route";
import { GET as GET_BATCHES } from "@/app/api/v1/credit-batches/route";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { createApiKey } from "@/data-access/api-keys";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { LINEAGE_LOCKED_COPY } from "./helpers/certified-output-lineage";
import { assignRemoval } from "./helpers/lab-sample-fixture";
import { createApiLabFixture, labApiParams, labApiRequest, removeApiLabFixture, type ApiLabFixture } from "./helpers/api-lab-sample-fixture";
import {
  EXPECTED_H_TO_C, expectNoLabSampleWrite, FUTURE_AT, labIdempotencyRecords, labSampleAudits, labSampleBody, labSampleRows,
  patchLabSample, postLabSample, seedRestLabSample, WRITE_SAMPLED_AT,
} from "./helpers/api-lab-sample-write-fixture";
import { rpc, rpcBody } from "./helpers/mcp";
import { uppercaseUuids } from "./helpers/uppercase-uuids";

const switches = vi.hoisted(() => ({ writesDisabled: false }));
vi.mock("@/config/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env")>();
  return { ...original, env: { ...original.env, get API_WRITES_DISABLED() { return switches.writesDisabled; } } };
});

const TIMEOUT_MS = 60_000;
const AUGUST_SAMPLED_AT = "2026-08-10T08:00:00.000Z";
const H_TO_C_NOTICE = `H/C_org calculated from hydrogen and organic carbon: ${EXPECTED_H_TO_C.toFixed(4)}`;
const WRITE_TOOLS = ["record_lab_sample", "update_lab_sample"];
const READ_TOOLS = ["find_lab_samples", "get_lab_sample", "find_credit_batches"];
let a: ApiLabFixture;
let b: ApiLabFixture;
beforeEach(async () => {
  a = await createApiLabFixture();
  b = await createApiLabFixture();
}, TIMEOUT_MS);
afterEach(async () => {
  switches.writesDisabled = false;
  await removeApiLabFixture(a);
  await removeApiLabFixture(b);
}, TIMEOUT_MS);

async function call(name: string, args: Record<string, unknown> = {}, key = a.writeKey) {
  const response = await MCP(rpc(key, "tools/call", { name, arguments: args }));
  expect(response.status).toBe(200);
  return (await rpcBody(response)).result;
}
const write = (name: string, args: Record<string, unknown>, key = a.writeKey) => call(name, { requestKey: randomUUID(), ...args }, key);
async function toolsFor(scopes: ApiScope[]) {
  const { key } = await createApiKey(a.ctx, { name: `Scoped ${scopes.length} ${randomUUID().slice(0, 8)}`, scopes, expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS });
  return (await rpcBody(await MCP(rpc(key, "tools/list")))).result.tools.map((tool: { name: string }) => tool.name) as string[];
}
const sampleArgs = (changes: Record<string, unknown> = {}) => labSampleBody(a, changes);
const noChange = async () => expectNoLabSampleWrite(a);
/** Create through MCP and return the saved representation. */
async function seedMcpLabSample(changes: Record<string, unknown> = {}) {
  const made = await write("record_lab_sample", sampleArgs(changes));
  expect(made.isError).toBeUndefined();
  return made.structuredContent.data as { id: string; code: string; version: number };
}

describe("lab sample MCP tools", { timeout: TIMEOUT_MS }, () => {
  it("lists tools by scope: write, delete, read, lab samples only and credit batches only", async () => {
    const writer = await toolsFor(["lab-samples:write"]);
    for (const name of WRITE_TOOLS) expect(writer).toContain(name);
    for (const name of [...READ_TOOLS, "delete_lab_sample"]) expect(writer).not.toContain(name);
    const deleter = await toolsFor(["lab-samples:delete"]);
    expect(deleter).toContain("delete_lab_sample");
    for (const name of [...READ_TOOLS, ...WRITE_TOOLS]) expect(deleter).not.toContain(name);
    const reader = await toolsFor(["lab-samples:read", "credit-batches:read"]);
    for (const name of READ_TOOLS) expect(reader).toContain(name);
    for (const name of [...WRITE_TOOLS, "delete_lab_sample"]) expect(reader).not.toContain(name);
    const samplesOnly = await toolsFor(["lab-samples:read"]);
    expect(samplesOnly).toEqual(expect.arrayContaining(["find_lab_samples", "get_lab_sample"]));
    expect(samplesOnly).not.toContain("find_credit_batches");
    expect(await toolsFor(["credit-batches:read"])).not.toContain("find_lab_samples");
    expect(writer).not.toContain("get_credit_batch");
    const { key } = await createApiKey(a.ctx, { name: "All lab", scopes: ["lab-samples:write", "lab-samples:delete"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS });
    const tools: { name: string; annotations: Record<string, boolean>; description: string; inputSchema: { properties: Record<string, unknown>; required?: string[] } }[] =
      (await rpcBody(await MCP(rpc(key, "tools/list")))).result.tools;
    const named = (name: string) => tools.find((tool) => tool.name === name)!;
    expect(named("record_lab_sample").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    for (const name of ["update_lab_sample", "delete_lab_sample"]) {
      expect(named(name).annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
      expect(named(name).inputSchema.required).toEqual(expect.arrayContaining(["labSampleId", "expectedVersion"]));
    }
    expect(named("record_lab_sample").inputSchema.properties).not.toHaveProperty("hToCOrgRatio");
    expect(named("record_lab_sample").description).toMatch(/whoami/);
    expect(named("record_lab_sample").description).toMatch(/dry basis/);
    expect(tools.some((tool) => /lab_samples$/.test(tool.name) && tool.name.startsWith("record"))).toBe(false);
  });

  it("records a sample with the REST 201 body, says the ratio was calculated, and audits it as mcp", async () => {
    const made = await write("record_lab_sample", sampleArgs({ totalOxygenPercent: 8 }));
    expect(made.isError).toBeUndefined();
    expect(Object.keys(made.structuredContent).sort()).toEqual(["data", "warnings"]);
    expect(made.structuredContent.data).toMatchObject({
      version: 1, creditBatchId: a.batchA.id, samplingTime: WRITE_SAMPLED_AT, hToCOrgRatio: EXPECTED_H_TO_C, totalCarbonPercent: 80,
    });
    expect(made.structuredContent.warnings[0]).toBe(H_TO_C_NOTICE);
    expect(made.structuredContent.warnings[1]).toMatch(/^O\/C_org calculated from oxygen and organic carbon: \d\.\d{4}$/);
    const text: string = made.content[0].text;
    expect(text).toContain(`Recorded lab sample ${made.structuredContent.data.code}`);
    expect(text).toContain(H_TO_C_NOTICE);
    for (const warning of made.structuredContent.warnings) expect(text).toContain(warning);
    expect(await labSampleRows(a)).toMatchObject([{ id: made.structuredContent.data.id, hToCOrgRatio: EXPECTED_H_TO_C }]);
    expect(await labSampleAudits(a)).toMatchObject([{
      operationId: "record_lab_sample", action: "created", source: "mcp", credentialId: a.writeCredentialId, versionAfter: 1,
    }]);
  });

  it("reads a facility-local { date, time } in the credit batch facility's zone", async () => {
    const made = await write("record_lab_sample", sampleArgs({ samplingTime: { date: "2026-09-10", time: "11:00" } }));
    expect(made.structuredContent.data.samplingTime).toBe(WRITE_SAMPLED_AT);
  });

  it("previews a create key-free without saving, and a key is required otherwise", async () => {
    const preview = await call("record_lab_sample", { ...sampleArgs(), dryRun: true });
    expect(preview.isError).toBeUndefined();
    expect(preview.content[0].text).toMatch(/^Dry run: would record lab sample/);
    expect(preview.content[0].text).toContain(H_TO_C_NOTICE);
    expect(preview.structuredContent.data).toMatchObject({ version: 1, hToCOrgRatio: EXPECTED_H_TO_C });
    expect(preview.structuredContent.warnings[0]).toBe(H_TO_C_NOTICE);
    await noChange();
  });

  it("requires a requestKey on every write and allows key-free dry runs only", async () => {
    const seeded = await seedMcpLabSample();
    const records = (await labIdempotencyRecords(a)).length;
    const audits = (await labSampleAudits(a)).length;
    for (const [name, args, key] of [
      ["record_lab_sample", sampleArgs(), a.writeKey],
      ["update_lab_sample", { labSampleId: seeded.id, expectedVersion: 1, labName: "Lab" }, a.writeKey],
      ["delete_lab_sample", { labSampleId: seeded.id, expectedVersion: 1 }, a.deleteKey],
    ] as const) {
      expect(await call(name, args, key), name).toMatchObject({ isError: true, structuredContent: { code: "idempotency_key_required" } });
      const dry = await call(name, { ...args, dryRun: true }, key);
      expect(dry.isError, name).toBeUndefined();
    }
    expect(await labIdempotencyRecords(a)).toHaveLength(records);
    expect(await labSampleAudits(a)).toHaveLength(audits);
    expect(await labSampleRows(a)).toHaveLength(1);
  });

  it("replays the same requestKey without a second write", async () => {
    const requestKey = randomUUID();
    const first = await call("record_lab_sample", { ...sampleArgs(), requestKey });
    const replay = await call("record_lab_sample", { ...sampleArgs(), requestKey });
    expect(replay.content[0].text).toMatch(/^Replayed: Recorded lab sample/);
    expect(replay.structuredContent).toEqual(first.structuredContent);
    expect(await labSampleRows(a)).toHaveLength(1);
    expect(await labSampleAudits(a)).toHaveLength(1);
    const reused = await call("record_lab_sample", { ...sampleArgs({ totalCarbonPercent: 81 }), requestKey });
    expect(reused).toMatchObject({ isError: true, structuredContent: { code: "idempotency_key_reused" } });
  });

  it("replays a REST key over MCP for a create and an update without a second write", async () => {
    const createKey = randomUUID();
    const rest = await postLabSample(a, sampleArgs(), createKey);
    expect(rest.status).toBe(201);
    const restBody = await rest.json();
    const replay = await call("record_lab_sample", { ...sampleArgs(), requestKey: createKey });
    expect(replay.content[0].text).toMatch(/^Replayed: Recorded lab sample/);
    expect(replay.structuredContent).toEqual(restBody);
    expect(await labSampleRows(a)).toHaveLength(1);
    const updateKey = randomUUID();
    const restUpdate = await patchLabSample(a, restBody.data.id, { labName: "REST Lab" }, '"1.1"', "", { "idempotency-key": updateKey });
    expect(restUpdate.status).toBe(200);
    const updateReplay = await call("update_lab_sample", { labSampleId: restBody.data.id, expectedVersion: 1, labName: "REST Lab", requestKey: updateKey });
    expect(updateReplay.content[0].text).toMatch(/^Replayed: Updated lab sample/);
    expect(updateReplay.structuredContent).toEqual(await restUpdate.json());
    expect((await labSampleRows(a))).toMatchObject([{ version: 2, labName: "REST Lab" }]);
    expect(await labSampleAudits(a)).toMatchObject([{ source: "rest" }, { source: "rest" }]);
  });

  it("replays an uppercase-UUID REST key over MCP in lowercase (api/uuid-case)", async () => {
    const key = randomUUID();
    const rest = await postLabSample(a, uppercaseUuids(sampleArgs()), key);
    expect(rest.status).toBe(201);
    const restBody = await rest.json();
    expect(restBody.data.creditBatchId).toBe(a.batchA.id);
    const replay = await call("record_lab_sample", { ...sampleArgs(), requestKey: key });
    expect(replay.content[0].text).toMatch(/^Replayed: /);
    expect(replay.structuredContent).toEqual(restBody);
    const upper = await call("record_lab_sample", { ...uppercaseUuids(sampleArgs()), requestKey: key });
    expect(upper.content[0].text).toMatch(/^Replayed: /);
    const updateKey = randomUUID();
    const restUpdate = await patchLabSample(a, restBody.data.id.toUpperCase(), { labName: "Upper" }, '"1.1"', "", { "idempotency-key": updateKey });
    expect(restUpdate.status).toBe(200);
    const updateReplay = await call("update_lab_sample", { labSampleId: restBody.data.id.toUpperCase(), expectedVersion: 1, labName: "Upper", requestKey: updateKey });
    expect(updateReplay.content[0].text).toMatch(/^Replayed: /);
    expect(await labSampleRows(a)).toHaveLength(1);
  });

  it("canonicalizes uppercase UUID arguments on every tool", async () => {
    const made = await write("record_lab_sample", uppercaseUuids(sampleArgs()));
    expect(made.structuredContent.data.creditBatchId).toBe(a.batchA.id);
    const id = made.structuredContent.data.id;
    const updated = await write("update_lab_sample", { labSampleId: id.toUpperCase(), expectedVersion: 1, labName: "Upper", creditBatchId: a.batchA.id.toUpperCase() });
    expect(updated.structuredContent.data).toMatchObject({ id, version: 2, labName: "Upper" });
    const deleted = await write("delete_lab_sample", { labSampleId: id.toUpperCase(), expectedVersion: 2 }, a.deleteKey);
    expect(deleted.structuredContent).toEqual({ deleted: { id, code: made.structuredContent.data.code } });
  });

  it("updates by version, recalculates the ratio, clears with null, and returns the current record when stale", async () => {
    const seeded = await seedMcpLabSample();
    const preview = await call("update_lab_sample", { labSampleId: seeded.id, expectedVersion: 1, totalHydrogenPercent: 3, dryRun: true });
    expect(preview.structuredContent.data).toMatchObject({ version: 2, hToCOrgRatio: 0.4766 });
    expect(preview.content[0].text).toMatch(/^Dry run: would update lab sample/);
    expect((await call("get_lab_sample", { idOrCode: seeded.id }, a.key)).structuredContent.data.version).toBe(1);
    const updated = await write("update_lab_sample", { labSampleId: seeded.id, expectedVersion: 1, totalHydrogenPercent: 3, labName: "Edit Lab" });
    expect(updated.structuredContent.data).toMatchObject({ version: 2, labName: "Edit Lab", hToCOrgRatio: 0.4766 });
    expect(updated.structuredContent.warnings[0]).toBe("H/C_org calculated from hydrogen and organic carbon: 0.4766");
    expect(updated.content[0].text).toContain("H/C_org calculated from hydrogen and organic carbon: 0.4766");
    const cleared = await write("update_lab_sample", { labSampleId: seeded.id, expectedVersion: 2, totalHydrogenPercent: null });
    expect(cleared.structuredContent.data).toMatchObject({ totalHydrogenPercent: null, hToCOrgRatio: null, version: 3 });
    const stale = await write("update_lab_sample", { labSampleId: seeded.id, expectedVersion: 1, labName: "Late" });
    expect(stale).toMatchObject({ isError: true, structuredContent: { code: "stale_version", current: cleared.structuredContent.data } });
    const refused = await write("update_lab_sample", { labSampleId: seeded.id, expectedVersion: 3, hToCOrgRatio: 0.3 });
    expect(refused).toMatchObject({ isError: true, structuredContent: { code: "validation_failed" } });
    const moved = await write("update_lab_sample", { labSampleId: seeded.id, expectedVersion: 3, creditBatchId: a.batchB!.id, samplingTime: AUGUST_SAMPLED_AT });
    expect(moved.structuredContent.data).toMatchObject({ creditBatchId: a.batchB!.id, version: 4 });
    expect(await labSampleAudits(a)).toMatchObject([{ source: "mcp" }, { source: "mcp" }, { source: "mcp" }, { source: "mcp" }]);
  });

  it("deletes with the delete scope only, previews the deletion, and returns the stale record", async () => {
    const seeded = await seedMcpLabSample();
    const args = { labSampleId: seeded.id, expectedVersion: 1 };
    const hidden = await rpcBody(await MCP(rpc(a.writeKey, "tools/call", { name: "delete_lab_sample", arguments: { ...args, requestKey: randomUUID() } })));
    expect(hidden).not.toHaveProperty("result");
    expect(hidden.error).toEqual((await rpcBody(await MCP(rpc(a.writeKey, "tools/call", { name: "unknown_tool", arguments: {} })))).error);
    expect(await labSampleRows(a)).toHaveLength(1);
    const preview = await call("delete_lab_sample", { ...args, dryRun: true }, a.deleteKey);
    expect(preview.structuredContent.data).toMatchObject({ id: seeded.id });
    expect(preview.content[0].text).toBe(`Dry run: would delete lab sample ${seeded.code}.`);
    expect(await labSampleRows(a)).toHaveLength(1);
    const changed = await write("update_lab_sample", { ...args, labName: "Edit" });
    const stale = await write("delete_lab_sample", args, a.deleteKey);
    expect(stale).toMatchObject({ isError: true, structuredContent: { code: "stale_version", current: changed.structuredContent.data } });
    const deleted = await write("delete_lab_sample", { ...args, expectedVersion: 2 }, a.deleteKey);
    expect(deleted.structuredContent).toEqual({ deleted: { id: seeded.id, code: seeded.code } });
    expect(deleted.content[0].text).toBe(`Deleted lab sample ${seeded.code}.`);
    expect(await labSampleRows(a)).toEqual([]);
    expect((await labSampleAudits(a)).map((row) => row.operationId).sort()).toEqual(["delete_lab_sample", "record_lab_sample", "update_lab_sample"]);
  });

  it("refuses the write tools without the write scope, and a write key cannot delete", async () => {
    for (const key of [a.key, a.deleteKey, a.otherScopeKey]) {
      const hidden = await rpcBody(await MCP(rpc(key, "tools/call", { name: "record_lab_sample", arguments: { ...sampleArgs(), requestKey: randomUUID() } })));
      expect(hidden).not.toHaveProperty("result");
      expect(hidden.error).toBeTruthy();
    }
    const seeded = await seedRestLabSample(a);
    const hidden = await rpcBody(await MCP(rpc(a.writeKey, "tools/call", { name: "delete_lab_sample", arguments: { labSampleId: seeded.row.id, expectedVersion: 1, requestKey: randomUUID() } })));
    expect(hidden).not.toHaveProperty("result");
    expect(await labSampleRows(a)).toHaveLength(1);
    expect(await labSampleAudits(a)).toHaveLength(1);
  });

  it("answers foreign ids as not found with no side effect, in arguments and filters", async () => {
    const foreign = await seedRestLabSample(b);
    for (const [name, args, key, pointer] of [
      ["record_lab_sample", sampleArgs({ creditBatchId: b.batchA.id }), a.writeKey, "/creditBatchId"],
      ["update_lab_sample", { labSampleId: foreign.row.id, expectedVersion: 1, labName: "No" }, a.writeKey, "/labSampleId"],
      ["update_lab_sample", { labSampleId: randomUUID(), expectedVersion: 1, creditBatchId: b.batchA.id, samplingTime: AUGUST_SAMPLED_AT }, a.writeKey, null],
      ["delete_lab_sample", { labSampleId: foreign.row.id, expectedVersion: 1 }, a.deleteKey, "/labSampleId"],
    ] as const) {
      const refusal = await write(name, args, key);
      expect(refusal, name).toMatchObject({ isError: true, structuredContent: { code: "not_found" } });
      if (pointer) expect(refusal.structuredContent.issues).toContainEqual(expect.objectContaining({ pointer, code: "not_found" }));
      expect(JSON.stringify(refusal)).not.toContain(foreign.row.code);
      expect(JSON.stringify(refusal)).not.toContain(b.batchA.code);
    }
    for (const [name, args] of [
      ["get_lab_sample", { idOrCode: foreign.row.id }], ["get_lab_sample", { idOrCode: foreign.row.code }],
      ["find_lab_samples", { creditBatchId: b.batchA.id }], ["find_lab_samples", { creditBatchId: b.batchA.id.toUpperCase() }],
      ["find_lab_samples", { facilityId: b.facility.id }], ["find_credit_batches", { facilityId: b.facility.id }],
    ] as const) {
      expect(await call(name, args, a.key), name).toMatchObject({ isError: true, structuredContent: { code: "not_found" } });
    }
    expect(await labSampleRows(a)).toEqual([]);
    expect(await labSampleAudits(a)).toEqual([]);
    expect(await labSampleRows(b)).toHaveLength(1);
    expect((await labSampleAudits(b)).filter((row) => row.source === "mcp")).toEqual([]);
  });

  it("refuses an archived batch on create and move with no side effect", async () => {
    const seeded = await seedMcpLabSample();
    await db.update(creditBatches).set({ archivedAt: new Date() }).where(and(eq(creditBatches.id, a.batchB!.id), eq(creditBatches.organizationId, a.ctx.organizationId)));
    const audits = (await labSampleAudits(a)).length;
    const created = await write("record_lab_sample", sampleArgs({ creditBatchId: a.batchB!.id, samplingTime: AUGUST_SAMPLED_AT }));
    expect(created).toMatchObject({ isError: true, structuredContent: { code: "not_found" } });
    expect(created.structuredContent.issues).toContainEqual(expect.objectContaining({ pointer: "/creditBatchId" }));
    const moved = await write("update_lab_sample", { labSampleId: seeded.id, expectedVersion: 1, creditBatchId: a.batchB!.id, samplingTime: AUGUST_SAMPLED_AT });
    expect(moved).toMatchObject({ isError: true, structuredContent: { code: "not_found" } });
    expect(await labSampleRows(a)).toMatchObject([{ id: seeded.id, version: 1, creditBatchId: a.batchA.id }]);
    expect(await labSampleAudits(a)).toHaveLength(audits);
  });

  it("refuses a time in the future and rejects unpublished fields", async () => {
    const future = await write("record_lab_sample", sampleArgs({ samplingTime: FUTURE_AT }));
    expect(future).toMatchObject({ isError: true, structuredContent: { code: "validation_failed" } });
    expect(future.structuredContent.issues).toContainEqual(expect.objectContaining({ pointer: "/samplingTime" }));
    for (const extra of [{ hToCOrgRatio: 0.3 }, { durabilityOption: "200_year" }, { productionRunId: randomUUID() }, { bogus: 1 }]) {
      const refusal = await write("record_lab_sample", sampleArgs(extra));
      expect(refusal).toMatchObject({ isError: true, structuredContent: { code: "validation_failed" } });
    }
    await noChange();
  });

  it("answers certification_locked when the batch lineage is in a certification", async () => {
    const seeded = await seedMcpLabSample();
    await assignRemoval(a, a.batchA, { submitted: true });
    const audits = (await labSampleAudits(a)).length;
    for (const [name, args, key] of [
      ["record_lab_sample", sampleArgs(), a.writeKey],
      ["update_lab_sample", { labSampleId: seeded.id, expectedVersion: 1, labName: "Locked" }, a.writeKey],
      ["delete_lab_sample", { labSampleId: seeded.id, expectedVersion: 1 }, a.deleteKey],
    ] as const) {
      const refusal = await write(name, args, key);
      expect(refusal, name).toMatchObject({ isError: true, structuredContent: { code: "certification_locked" } });
      expect(refusal.structuredContent.detail).toContain(LINEAGE_LOCKED_COPY);
    }
    expect(await labSampleRows(a)).toMatchObject([{ id: seeded.id, version: 1 }]);
    expect(await labSampleAudits(a)).toHaveLength(audits);
  });

  it("answers API_WRITES_DISABLED inside MCP and keeps reads working", async () => {
    const seeded = await seedMcpLabSample();
    switches.writesDisabled = true;
    for (const [name, key] of [["record_lab_sample", a.writeKey], ["update_lab_sample", a.writeKey], ["delete_lab_sample", a.deleteKey]] as const) {
      expect(await call(name, { requestKey: randomUUID() }, key), name).toMatchObject({ isError: true, structuredContent: { code: "api_writes_disabled", retryable: true } });
    }
    expect((await call("get_lab_sample", { idOrCode: seeded.id }, a.key)).isError).toBeUndefined();
    expect(await labSampleRows(a)).toHaveLength(1);
  });

  it("serves reads with the REST list and item envelopes", async () => {
    const seeded = await seedMcpLabSample();
    const restList = await GET_LIST(labApiRequest("lab-samples", `?creditBatchId=${a.batchA.id}`, a.key));
    expect((await call("find_lab_samples", { creditBatchId: a.batchA.id }, a.key)).structuredContent).toEqual(await restList.json());
    for (const idOrCode of [seeded.id, seeded.code]) {
      const rest = await GET_ONE(labApiRequest("lab-samples", `/${idOrCode}`, a.key), labApiParams(idOrCode));
      const result = await call("get_lab_sample", { idOrCode }, a.key);
      expect(result.structuredContent).toEqual(await rest.json());
      expect(result.content[0].text).toBe(`Lab sample ${seeded.code}, version 1.`);
    }
    const batches = await GET_BATCHES(labApiRequest("credit-batches", `?facilityId=${a.facility.id}`, a.key));
    expect((await call("find_credit_batches", { facilityId: a.facility.id }, a.key)).structuredContent).toEqual(await batches.json());
    expect(await call("find_lab_samples", { sampledFrom: "2026-09-10T08:00:00" }, a.key)).toMatchObject({ isError: true });
  });

  it("refuses the read tools without their read scope", async () => {
    for (const [name, args, key] of [
      ["find_lab_samples", {}, a.creditBatchesOnlyKey], ["get_lab_sample", { idOrCode: randomUUID() }, a.creditBatchesOnlyKey],
      ["find_credit_batches", {}, a.labSamplesOnlyKey], ["find_lab_samples", {}, a.writeOnlyKey],
    ] as const) {
      const hidden = await rpcBody(await MCP(rpc(key, "tools/call", { name, arguments: args })));
      expect(hidden, name).not.toHaveProperty("result");
    }
  });
});
