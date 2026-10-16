import { apiActivityWhere } from "./helpers/api-activity";
/** Real server actions, REST and MCP over the worktree test database. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apiIdempotencyRecords, activityEvents, applications, deliveries, members, apiKeys } from "@/db/schema";
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { createApplicationFn, updateApplicationFn, deleteApplicationFn } from "@/fn/applications";
import { recordApplication, updateApplication } from "@/lib/operations/applications";
import { normalizeGeoJson } from "@/lib/geojson/normalize";
import { jsonPointer } from "@/lib/api/problem";
import type { DomainIssue } from "@/lib/domain-errors";
import { recordApplicationInput, updateApplicationInput } from "@/schemas/application-input";
import { createLineageFixture, cleanupLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";
import { APPLICATION_TEST_TIMEOUT_MS as TIMEOUT, APPLICATION_POLYGON, applicationInput, applicationRows, applicationTool, cleanupApiApplicationWriteFixture, createApiApplicationWriteFixture, postApplication, patchApplication, deleteApplication, readRestApplication, type ApiApplicationWriteFixture } from "./helpers/api-application-write-fixture";

const auth = vi.hoisted(() => ({ requireOrgContext: vi.fn() }));
vi.mock("@/lib/auth/server", async original => ({ ...await original<typeof import("@/lib/auth/server")>(), requireOrgContext: auth.requireOrgContext }));
const TRANSPORTS = ["action", "rest", "mcp"] as const;
type Transport = typeof TRANSPORTS[number];
const fixtures = new Map<Transport, ApiApplicationWriteFixture>();
beforeEach(async () => { for (const transport of TRANSPORTS) fixtures.set(transport, await createApiApplicationWriteFixture()); }, TIMEOUT);
afterEach(async () => {
  vi.restoreAllMocks(); auth.requireOrgContext.mockReset();
  for (const f of fixtures.values()) await cleanupApiApplicationWriteFixture(f);
  fixtures.clear();
}, TIMEOUT);
function envelope(raw: object) {
  const result = normalizeGeoJson({ text: JSON.stringify(raw), source: "paste" });
  if (!result.ok) throw new Error(result.error);
  return result.boundary;
}
const geometry = envelope(APPLICATION_POLYGON);
const base = (f: ApiApplicationWriteFixture) => applicationInput(f, { gisBoundary: APPLICATION_POLYGON });
function scrub(value: unknown, f: ApiApplicationWriteFixture): unknown {
  const dropped = new Set(["id", "code", "createdAt", "updatedAt", "cursorCreatedAt", "source", "capturedAt", "createdBy"]);
  const labels = [
    [f.ctx.organizationId, "org"], [f.chain.deliveryIds[0], "delivery-a"], [f.chain.deliveryIds[1], "delivery-b"],
    [f.chain.customerLocationId, "site"], [f.chain.productId, "product"], [f.chain.facilityId, "facility"],
  ];
  let text = JSON.stringify(value, (key, v) => dropped.has(key) ? undefined : v).replaceAll(f.tag, "<tag>");
  for (const [id, label] of labels) text = text.replaceAll(id, `<${label}>`);
  // The product fixture creates one run; its generated identity and code vary by fixture.
  text = text.replaceAll(/"productionRunId":"[^"]+"/g, '"productionRunId":"<run>"')
    .replaceAll(/"productionRunCode":"[^"]+"/g, '"productionRunCode":"<run-code>"');
  return JSON.parse(text);
}
async function create(transport: Transport, f: ApiApplicationWriteFixture) {
  if (transport === "action") {
    auth.requireOrgContext.mockResolvedValue(f.ctx);
    // Actions expose the native application only. Observe their real operation result
    // to compare allocations, balance and advisory warnings without changing the app contract.
    const observed = vi.spyOn(recordApplication, "execute");
    const result = await createApplicationFn(recordApplicationInput.parse({ ...base(f), gisBoundary: geometry }));
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    const output = await observed.mock.results.at(-1)!.value;
    expect(result.data).toEqual(output.application);
    const { body } = await readRestApplication(f, result.data.id);
    observed.mockRestore();
    return { data: body.data, allocations: output.allocations, deliveryBalance: output.deliveryBalance, warnings: output.warnings };
  }
  if (transport === "rest") {
    const response = await postApplication(f, base(f)); expect(response.status).toBe(201);
    const output = await response.json(); return { ...output, warnings: output.warnings ?? [] };
  }
  const result = await applicationTool(f, "record_application", { ...base(f), requestKey: randomUUID() });
  expect(result.isError).toBeUndefined(); return { ...result.structuredContent, warnings: result.structuredContent.warnings ?? [] };
}
async function update(transport: Transport, f: ApiApplicationWriteFixture, id: string, changes: object) {
  const current = await readRestApplication(f, id);
  if (transport === "action") {
    auth.requireOrgContext.mockResolvedValue(f.ctx); const observed = vi.spyOn(updateApplication, "execute");
    const result = await updateApplicationFn(updateApplicationInput.parse({ applicationId: id, expectedVersion: current.body.data.version, ...changes }));
    expect(result.success).toBe(true); if (!result.success) throw new Error(result.error);
    const output = await observed.mock.results.at(-1)!.value;
    expect(result.data).toEqual(output.application);
    observed.mockRestore(); const { body } = await readRestApplication(f, id);
    return { data: body.data, allocations: output.allocations, deliveryBalance: output.deliveryBalance, warnings: output.warnings };
  }
  if (transport === "rest") {
    const response = await patchApplication(f, id, changes, current.etag); expect(response.status).toBe(200);
    const output = await response.json(); return { ...output, warnings: output.warnings ?? [] };
  }
  const result = await applicationTool(f, "update_application", { applicationId: id, expectedVersion: current.body.data.version, ...changes, requestKey: randomUUID() });
  expect(result.isError).toBeUndefined(); return { ...result.structuredContent, warnings: result.structuredContent.warnings ?? [] };
}
function equalAcross(outputs: unknown[]) { expect(outputs[1]).toEqual(outputs[0]); expect(outputs[2]).toEqual(outputs[0]); }
async function state(f: ApiApplicationWriteFixture, id: string) {
  const row = (await applicationRows(f)).find(row => row.id === id)!;
  return { row, geometry: row.gisBoundary && { collection: row.gisBoundary.collection, stats: row.gisBoundary.stats }, representation: (await readRestApplication(f, id)).body };
}
it("creates the same fields, normalized collection and stats, allocations, balance and named warnings", async () => {
  const outputs = [];
  for (const transport of TRANSPORTS) {
    const f = fixtures.get(transport)!; const output = await create(transport, f);
    expect(output.data).toMatchObject({ applicationDate: "2025-07-08", appliedWetMassKg: 1200, dryBiocharKg: 960, fieldSizeHa: 3, gpsLatitude: -3.3, gpsLongitude: 37.3 });
    expect(output.deliveryBalance).toEqual({ remainingWetMassKgBefore: 5000, remainingWetMassKgAfter: 3800 });
    expect(output.warnings).toContain(`GPS copied from customer location Application Mutation Location ${f.tag}.`);
    expect((await applicationRows(f))[0].gisBoundary!.source).toBe(transport === "action" ? "paste" : "api");
    outputs.push(scrub({ output, state: await state(f, output.data.id) }, f));
  }
  equalAcross(outputs);
}, TIMEOUT);
it("merges omitted fields, clears nullable values and repoints with the same allocations and target balance", async () => {
  const outputs = [];
  for (const transport of TRANSPORTS) {
    const f = fixtures.get(transport)!; const made = await create(transport, f);
    const changed = await update(transport, f, made.data.id, { cropType: null, appliedWetMassKg: 1500, soilTemperatureC: null, soilTemperatureSource: null });
    expect(changed.data).toMatchObject({ version: 2, cropType: null, fieldIdentifier: "North", fieldSizeHa: 3 });
    const moved = await update(transport, f, made.data.id, { deliveryId: f.chain.deliveryIds[1] });
    expect(moved.data).toMatchObject({ version: 3, appliedWetMassKg: 1500, dryBiocharKg: 1350, cropType: null, soilTemperatureC: null });
    expect(moved.deliveryBalance).toEqual({ remainingWetMassKgBefore: 3000, remainingWetMassKgAfter: 1500 });
    expect(moved.warnings.some((warning: string) => warning.includes("copied"))).toBe(false);
    outputs.push(scrub({ changed, moved, state: await state(f, made.data.id) }, f));
  }
  equalAcross(outputs);
}, TIMEOUT);
it("deletes the same row and restores its delivery balance, with transport-specific activity", async () => {
  const outputs = [];
  for (const transport of TRANSPORTS) {
    const f = fixtures.get(transport)!; const made = await create(transport, f); const id = made.data.id;
    const current = await readRestApplication(f, id);
    if (transport === "action") { auth.requireOrgContext.mockResolvedValue(f.ctx); expect(await deleteApplicationFn({ applicationId: id, expectedVersion: 1 })).toEqual({ success: true, data: undefined }); }
    else if (transport === "rest") expect((await deleteApplication(f, id, current.etag)).status).toBe(204);
    else expect((await applicationTool(f, "delete_application", { applicationId: id, expectedVersion: 1, requestKey: randomUUID() })).structuredContent).toEqual({ deleted: { id, code: made.data.code } });
    expect(await applicationRows(f)).toEqual([]);
    const balance = await applicationTool(f, "get_delivery_application_balance", { idOrCode: f.chain.deliveryIds[0] });
    outputs.push(scrub(balance.structuredContent, f));
    const audits = await db.selectDistinct({ requestId: activityEvents.requestId, source: activityEvents.source }).from(activityEvents).where(apiActivityWhere(f.ctx.organizationId));
    expect(audits.map(row => row.source)).toEqual(transport === "action" ? [] : [transport, transport]);
    const events = await db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId));
    expect(events.length).toBeGreaterThan(0); expect(events.every(row => row.source === (transport === "action" ? "form" : transport))).toBe(true);
  }
  equalAcross(outputs);
}, TIMEOUT);
interface Issue { pointer: string; code: string; meta?: Record<string, unknown> }
const actionIssues = (issues: DomainIssue[] = []): Issue[] => issues.map(({ path, code, meta }) => ({ pointer: jsonPointer(path), code, ...(meta ? { meta } : {}) }));
const apiIssues = (issues: Issue[] = []): Issue[] => issues.map(({ pointer, code, meta }) => ({ pointer, code, ...(meta ? { meta } : {}) }));
async function refuse(transport: Transport, f: ApiApplicationWriteFixture, changes: object, id?: string, expectedVersion = 1) {
  if (transport === "action") {
    auth.requireOrgContext.mockResolvedValue(f.ctx);
    const result = id ? await updateApplicationFn({ applicationId: id, expectedVersion, ...changes }) : await createApplicationFn({ ...applicationInput(f), ...changes });
    expect(result.success).toBe(false); if (result.success) throw new Error("Expected refusal");
    return { code: result.code, issues: actionIssues(result.issues) };
  }
  if (transport === "rest") {
    const current = id ? await readRestApplication(f, id) : null;
    const response = id ? await patchApplication(f, id, changes, current!.etag) : await postApplication(f, { ...applicationInput(f), ...changes });
    expect(response.status).toBeGreaterThanOrEqual(400); const result = await response.json(); return { code: result.code, issues: apiIssues(result.errors) };
  }
  const result = await applicationTool(f, id ? "update_application" : "record_application", { ...(id ? { applicationId: id, expectedVersion } : applicationInput(f)), ...changes, requestKey: randomUUID() });
  expect(result.isError).toBe(true); return { code: result.structuredContent.code, issues: apiIssues(result.structuredContent.issues) };
}
it.each([
  { name: "capacity", changes: { appliedWetMassKg: 5000.001 }, code: "conflict", pointer: "/appliedWetMassKg" },
  { name: "future date", changes: { applicationDate: "2099-01-01" }, code: "validation_failed", pointer: "/applicationDate" },
  { name: "before delivery", changes: { applicationDate: "2025-07-04" }, code: "validation_failed", pointer: "/applicationDate" },
  { name: "Q79 boundary", changes: { evidenceMethod: "boundary" as const }, code: "validation_failed", pointer: "/gisBoundary" },
  { name: "foreign delivery", changes: {}, code: "not_found", pointer: "/deliveryId" },
  { name: "archived delivery", changes: {}, code: "not_found", pointer: "/deliveryId" },
])("returns equal codes, pointers and metadata for $name without side effects", async ({ name, changes, code, pointer }) => {
  const outputs = [];
  for (const transport of TRANSPORTS) {
    const f = fixtures.get(transport)!; let input: object = changes;
    if (name === "foreign delivery") input = { deliveryId: fixtures.get(transport === "action" ? "rest" : "action")!.chain.deliveryIds[0] };
    if (name === "archived delivery") await db.update(deliveries).set({ archivedAt: new Date() }).where(eq(deliveries.id, f.chain.deliveryIds[0]));
    const failure = await refuse(transport, f, input); expect(failure).toMatchObject({ code, issues: expect.arrayContaining([expect.objectContaining({ pointer })]) });
    if (name === "capacity") expect(failure.issues[0].meta).toEqual({ measure: "delivery_remaining_wet", availableWetKg: 5000, requestedWetKg: 5000.001, unit: "kg" });
    outputs.push(failure); expect(await applicationRows(f)).toEqual([]);
    expect(await db.select().from(activityEvents).where(apiActivityWhere(f.ctx.organizationId))).toEqual([]);
    expect(await db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, f.ctx.organizationId))).toEqual([]);
  }
  equalAcross(outputs);
}, TIMEOUT);
it("validates Q79 on the merged update state equally", async () => {
  const failures = [];
  for (const transport of TRANSPORTS) {
    const f = fixtures.get(transport)!; const made = await create(transport, f);
    await update(transport, f, made.data.id, { evidenceMethod: "boundary" });
    const before = await applicationRows(f);
    const failure = await refuse(transport, f, { gisBoundary: null }, made.data.id, 2);
    expect(failure).toMatchObject({ code: "validation_failed", issues: [{ pointer: "/gisBoundary" }] });
    expect(await applicationRows(f)).toEqual(before); failures.push(failure);
  }
  equalAcross(failures);
}, TIMEOUT);
it("refuses submitted lineage updates and deletes equally", async () => {
  await ensureTestOrg(); const f = fixtures.get("action")!; const ctx = makeTestOrgContext(f.ctx.userId); const memberId = randomUUID();
  await db.insert(members).values({ id: memberId, organizationId: ctx.organizationId, userId: ctx.userId, role: "owner" });
  const credential = await createApiKey(ctx, { name: "Parity submitted applications", scopes: ["applications:read", "applications:write", "applications:delete"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS });
  const lineage = await createLineageFixture("removal");
  const locked = { ...f, ctx, applicationKey: credential.key };
  try {
    const current = await readRestApplication(locked, lineage.applicationId);
    const failures = [];
    for (const transport of TRANSPORTS) failures.push(await refuse(transport, locked, { cropType: "Maize" }, lineage.applicationId, current.body.data.version));
    equalAcross(failures); expect(failures[0].code).toBe("certification_locked");
    const deletes = [];
    for (const transport of TRANSPORTS) {
      if (transport === "action") {
        auth.requireOrgContext.mockResolvedValue(ctx); const result = await deleteApplicationFn({ applicationId: lineage.applicationId, expectedVersion: current.body.data.version });
        if (result.success) throw new Error("Expected refusal"); deletes.push({ code: result.code, issues: actionIssues(result.issues) });
      } else if (transport === "rest") {
        const response = await deleteApplication(locked, lineage.applicationId, current.etag); expect(response.status).toBe(409); const result = await response.json(); deletes.push({ code: result.code, issues: apiIssues(result.errors) });
      } else {
        const result = await applicationTool(locked, "delete_application", { applicationId: lineage.applicationId, expectedVersion: current.body.data.version, requestKey: randomUUID() });
        expect(result.isError).toBe(true); deletes.push({ code: result.structuredContent.code, issues: apiIssues(result.structuredContent.issues) });
      }
    }
    equalAcross(deletes); expect(deletes[0].code).toBe("certification_locked");
    expect((await readRestApplication(locked, lineage.applicationId)).body).toEqual(current.body);
  } finally { await cleanupLineageFixture(lineage); await db.delete(apiKeys).where(eq(apiKeys.id, credential.id)); await db.delete(members).where(eq(members.id, memberId)); }
}, TIMEOUT);

it("saves a full app form on a legacy visual application without GPS or boundary", async () => {
  const f = fixtures.get("action")!;
  const made = await create("action", f);
  await db.update(applications).set({ evidenceMethod: "visual", gpsLatitude: null, gpsLongitude: null, gisBoundary: null }).where(eq(applications.id, made.data.id));
  auth.requireOrgContext.mockResolvedValue(f.ctx);
  const result = await updateApplicationFn({
    ...applicationInput(f), applicationId: made.data.id, expectedVersion: made.data.version,
    applicationDate: new Date("2025-07-08"), evidenceMethod: "visual", gpsLatitude: null, gpsLongitude: null,
    gisBoundary: null, applicationMethod: null, soilTemperatureC: null, soilTemperatureSource: null, cropType: "Beans",
  });
  expect(result).toMatchObject({ success: true, data: { cropType: "Beans", evidenceMethod: "visual", gpsLatitude: null, gpsLongitude: null, gisBoundary: null } });
}, TIMEOUT);
