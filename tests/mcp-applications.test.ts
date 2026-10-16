/** Real MCP endpoint, REST handlers, credentials and Postgres. Run only by explicit path. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { eq, and, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, apiKeys, members } from "@/db/schema";
import { POST as MCP } from "@/app/api/mcp/route";
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { env } from "@/config/env";
import { rpc, rpcBody } from "./helpers/mcp";
import { createLineageFixture, cleanupLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";
import { APPLICATION_TEST_TIMEOUT_MS as TIMEOUT, APPLICATION_POLYGON, applicationInput, applicationRows, applicationTool, cleanupApiApplicationWriteFixture, createApiApplicationWriteFixture, postApplication, readRestApplication, type ApiApplicationWriteFixture } from "./helpers/api-application-write-fixture";
let f: ApiApplicationWriteFixture;
beforeEach(async () => { f = await createApiApplicationWriteFixture(); }, TIMEOUT);
afterEach(async () => { if (f) await cleanupApiApplicationWriteFixture(f); }, TIMEOUT);
const call = (name: string, args: object) => applicationTool(f, name, args);
const write = (name: string, args: object) => call(name, { requestKey: randomUUID(), ...args });
async function failure(name: string, args: object, code: string, pointer?: string) {
  const result = await (name.startsWith("find_") || name.startsWith("get_") ? call(name, args) : write(name, args));
  expect(result).toMatchObject({ isError: true, structuredContent: { code, ...(pointer ? { issues: expect.arrayContaining([expect.objectContaining({ pointer })]) } : {}) } });
  return result.structuredContent;
}
it("finds remaining delivery mass, previews, records raw GeoJSON, gets, updates, refuses stale, and deletes", async () => {
  const found = await call("find_deliveries", { facilityId: f.chain.facilityId, hasRemainingMass: "true" });
  expect(found.structuredContent.data.map((row: { id: string }) => row.id)).toContain(f.chain.deliveryIds[0]);
  const balance = await call("get_delivery_application_balance", { idOrCode: f.chain.deliveryIds[0] });
  expect(balance.structuredContent.data.remainingWetMassKg).toBe(5000);
  const input = applicationInput(f, { evidenceMethod: "boundary", gisBoundary: APPLICATION_POLYGON });
  const preview = await call("record_application", { ...input, dryRun: true });
  expect(preview.isError).toBeUndefined(); expect(await applicationRows(f)).toEqual([]);
  const created = await write("record_application", input);
  expect(created.isError).toBeUndefined(); const row = created.structuredContent.data;
  expect(row).toMatchObject({ appliedWetMassKg: 1200, dryBiocharKg: 960, gisBoundary: { featureCount: 1 } });
  expect(created.structuredContent.allocations).toEqual(preview.structuredContent.allocations);
  expect(created.structuredContent.deliveryBalance).toEqual(preview.structuredContent.deliveryBalance);
  expect(created.structuredContent.warnings).toEqual(preview.structuredContent.warnings);
  expect((await call("get_application", { idOrCode: row.code })).structuredContent).toEqual((await readRestApplication(f, row.id)).body);
  const page = await call("find_applications", { deliveryId: row.deliveryId }); expect(page.structuredContent.data).toEqual([row]);
  const updated = await write("update_application", { applicationId: row.id, expectedVersion: row.version, cropType: null });
  expect(updated.structuredContent.data).toMatchObject({ version: 2, cropType: null, fieldIdentifier: "North" });
  const stale = await failure("update_application", { applicationId: row.id, expectedVersion: row.version, cropType: "Stale" }, "stale_version");
  expect(stale.current).toEqual(updated.structuredContent.data);
  const dryDelete = await write("delete_application", { applicationId: row.id, expectedVersion: 2, dryRun: true });
  expect(dryDelete.structuredContent.data).toEqual(updated.structuredContent.data);
  const deleted = await write("delete_application", { applicationId: row.id, expectedVersion: 2 });
  expect(deleted.structuredContent).toEqual({ deleted: { id: row.id, code: row.code } });
  await failure("get_application", { idOrCode: row.id }, "not_found");
  expect((await call("get_delivery_application_balance", { idOrCode: row.deliveryId })).structuredContent.data.remainingWetMassKg).toBe(5000);
  const audits = await db.selectDistinct({ requestId: activityEvents.requestId, operationId: activityEvents.operationId, source: activityEvents.source }).from(activityEvents).where(and(inArray(activityEvents.source, ["rest", "mcp"]), isNotNull(activityEvents.operationId), eq(activityEvents.organizationId, f.ctx.organizationId)));
  expect(audits.map(row => [row.operationId, row.source]).sort()).toEqual([["delete_application", "mcp"], ["record_application", "mcp"], ["update_application", "mcp"]]);
  const events = await db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId));
  expect(events.length).toBeGreaterThan(0); expect(events.every(row => row.source === "mcp")).toBe(true);
}, TIMEOUT);
it("replays one raw request across MCP and REST before stale and deleted checks", async () => {
  const key = randomUUID(); const input = applicationInput(f, { gisBoundary: APPLICATION_POLYGON });
  const first = await call("record_application", { ...input, requestKey: key });
  const replay = await call("record_application", { ...input, requestKey: key });
  expect(replay.structuredContent).toEqual(first.structuredContent); expect(replay.content[0].text).toContain("Replayed:");
  const rest = await postApplication(f, input, key); expect(rest.headers.get("idempotent-replayed")).toBe("true");
  expect(await rest.json()).toEqual(first.structuredContent);
  const row = first.structuredContent.data;
  const updateArgs = { applicationId: row.id, expectedVersion: row.version, cropType: null, requestKey: randomUUID() };
  const updated = await call("update_application", updateArgs);
  expect((await call("update_application", updateArgs)).structuredContent).toEqual(updated.structuredContent);
  const deleteArgs = { applicationId: row.id, expectedVersion: 2, requestKey: randomUUID() };
  const deleted = await call("delete_application", deleteArgs);
  expect((await call("delete_application", deleteArgs)).structuredContent).toEqual(deleted.structuredContent);
  const historical = await call("record_application", { ...input, requestKey: key }); expect(historical.structuredContent).toEqual(first.structuredContent);
  expect(await applicationRows(f)).toEqual([]);
}, TIMEOUT);
it("returns REST refusal codes, pointers and capacity metadata as isError without saving", async () => {
  const capacity = await failure("record_application", applicationInput(f, { appliedWetMassKg: 5000.001 }), "conflict", "/appliedWetMassKg");
  expect(capacity.issues[0].meta).toEqual({ measure: "delivery_remaining_wet", availableWetKg: 5000, requestedWetKg: 5000.001, unit: "kg" });
  await failure("record_application", applicationInput(f, { applicationDate: "2099-01-01" }), "validation_failed", "/applicationDate");
  await failure("record_application", applicationInput(f, { evidenceMethod: "boundary" }), "validation_failed", "/gisBoundary");
  await failure("record_application", applicationInput(f, { gisBoundary: { source: "paste", collection: {} } }), "validation_failed", "/gisBoundary");
  expect(await applicationRows(f)).toEqual([]);
}, TIMEOUT);
it("hides foreign applications and deliveries for reads, filters and writes", async () => {
  const other = await createApiApplicationWriteFixture();
  try {
    const made = await applicationTool(other, "record_application", { ...applicationInput(other), requestKey: randomUUID() }); const row = made.structuredContent.data;
    for (const expectedVersion of [row.version, row.version + 1]) {
      await failure("update_application", { applicationId: row.id, expectedVersion, cropType: null }, "not_found");
      await failure("delete_application", { applicationId: row.id, expectedVersion }, "not_found");
    }
    await failure("get_application", { idOrCode: row.id }, "not_found");
    await failure("get_delivery_application_balance", { idOrCode: other.chain.deliveryIds[0] }, "not_found");
    await failure("find_applications", { deliveryId: other.chain.deliveryIds[0] }, "not_found");
    await failure("record_application", applicationInput(f, { deliveryId: other.chain.deliveryIds[0] }), "not_found", "/deliveryId");
    expect(await applicationRows(f)).toEqual([]);
  } finally { await cleanupApiApplicationWriteFixture(other); }
}, TIMEOUT);
it("refuses submitted lineage updates and deletes with certification_locked", async () => {
  await ensureTestOrg(); const ctx = makeTestOrgContext(f.ctx.userId); const memberId = randomUUID();
  await db.insert(members).values({ id: memberId, organizationId: ctx.organizationId, userId: ctx.userId, role: "owner" });
  const credential = await createApiKey(ctx, { name: "Application lineage MCP", scopes: ["applications:read", "applications:write", "applications:delete"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS });
  const lineage = await createLineageFixture("removal");
  try {
    const current = await applicationTool(f, "get_application", { idOrCode: lineage.applicationId }, credential.key);
    for (const name of ["update_application", "delete_application"]) {
      const result = await applicationTool(f, name, { applicationId: lineage.applicationId, expectedVersion: current.structuredContent.data.version, requestKey: randomUUID() }, credential.key);
      expect(result).toMatchObject({ isError: true, structuredContent: { code: "certification_locked" } });
    }
  } finally { await cleanupLineageFixture(lineage); await db.delete(apiKeys).where(eq(apiKeys.id, credential.id)); await db.delete(members).where(eq(members.id, memberId)); }
}, TIMEOUT);
it("uses the write kill switch while reads keep working", async () => {
  const previous = env.API_WRITES_DISABLED; env.API_WRITES_DISABLED = true;
  try {
    expect(await write("record_application", applicationInput(f))).toMatchObject({ isError: true, structuredContent: { code: "api_writes_disabled" } });
    expect((await call("find_applications", {})).isError).toBeUndefined();
    expect(await applicationRows(f)).toEqual([]);
  } finally { env.API_WRITES_DISABLED = previous; }
}, TIMEOUT);
it("lists reads and writes only under their own scopes", async () => {
  for (const [scopes, expected] of [
    [["applications:read"], ["find_applications", "get_application"]],
    [["deliveries:read"], ["get_delivery_application_balance"]],
    [["applications:write"], ["record_application", "update_application"]],
    [["applications:delete"], ["delete_application"]],
  ] as const) {
    const credential = await createApiKey(f.ctx, { name: "Application tool scope", scopes: [...scopes], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS });
    const { result } = await rpcBody(await MCP(rpc(credential.key, "tools/list")));
    const names = result.tools.map((tool: { name: string }) => tool.name);
    for (const name of ["find_applications", "get_application", "get_delivery_application_balance", "record_application", "update_application", "delete_application"]) expect(names.includes(name)).toBe((expected as readonly string[]).includes(name));
  }
}, TIMEOUT);
it("replays a REST raw-geometry create through MCP and normalizes raw-geometry updates", async () => {
  const requestKey = randomUUID(); const input = applicationInput(f, { gisBoundary: APPLICATION_POLYGON });
  const rest = await postApplication(f, input, requestKey); expect(rest.status).toBe(201); const body = await rest.json();
  const replay = await call("record_application", { ...input, requestKey });
  expect(replay.structuredContent).toEqual(body); expect(replay.content[0].text).toContain("Replayed:");
  const changed = { ...APPLICATION_POLYGON, coordinates: APPLICATION_POLYGON.coordinates.map(ring => ring.map(([lon, lat]) => [lon + 0.01, lat])) };
  const updateArgs = { applicationId: body.data.id.toUpperCase(), expectedVersion: 1, gisBoundary: changed, requestKey: randomUUID() };
  const update = await call("update_application", updateArgs); expect(update.isError).toBeUndefined();
  expect(update.structuredContent.data.gisBoundary.bbox).not.toEqual(body.data.gisBoundary.bbox);
  expect((await applicationRows(f))[0].gisBoundary).toMatchObject({ source: "api", collection: { features: [{ geometry: changed }] } });
  expect((await call("update_application", updateArgs)).structuredContent).toEqual(update.structuredContent);
  await failure("update_application", { ...updateArgs, gisBoundary: APPLICATION_POLYGON }, "idempotency_key_reused");
  const stale = await failure("delete_application", { applicationId: body.data.id, expectedVersion: 1 }, "stale_version");
  expect(stale.current).toEqual(update.structuredContent.data);
}, TIMEOUT);
it("finds exhausted deliveries with false and hides them with true", async () => {
  const saved = await write("record_application", applicationInput(f, { appliedWetMassKg: 5000 }));
  expect(saved.isError).toBeUndefined();
  for (const hasRemainingMass of ["true", "false"]) {
    const result = await call("find_deliveries", { facilityId: f.chain.facilityId, hasRemainingMass });
    const ids = result.structuredContent.data.map((row: { id: string }) => row.id);
    expect(ids.includes(f.chain.deliveryIds[0])).toBe(hasRemainingMass === "false");
  }
  expect((await call("get_delivery_application_balance", { idOrCode: f.chain.deliveryIds[0] })).structuredContent.data.remainingWetMassKg).toBe(0);
}, TIMEOUT);
