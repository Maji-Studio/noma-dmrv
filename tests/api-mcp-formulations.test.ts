import { fixture, formulationRouteHarness, commands, domainFields, TIMEOUT_MS, type Fixture, type Command } from "./helpers/formulation-route-fixture";
import { POST as MCP } from "@/app/api/mcp/route";
import { rpc, rpcBody } from "./helpers/mcp";
import { percentFormToRatioPayload } from "@/schemas/formulations";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, apiIdempotencyRecords, feedstockTypes } from "@/db/schema";
import { createFormulationFn, updateFormulationFn, deleteFormulationFn, archiveFormulationFn, restoreFormulationFn } from "@/fn/formulations";
import { jsonPointer } from "@/lib/api/problem";
import { makeBiocharProduct } from "@/lib/operations/biochar-products";
import { runOperation } from "@/lib/operations/runner";
import { GET as LIST } from "@/app/api/v1/formulations/route";
import { GET } from "@/app/api/v1/formulations/[idOrCode]/route";
import { type FormulationRepresentation } from "@/lib/representations/formulations";
import { insertReadOrder, removeApiOrderReadFixture, readParams, readRequest } from "./helpers/api-order-read-fixture";

// Only the request-session boundary is simulated. Both transports resolve real org membership.
const auth = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/auth/providers/better-auth-server", async original => ({
  ...await original<typeof import("@/lib/auth/providers/better-auth-server")>(), getBetterAuthSession: auth.session,
}));

let a: Fixture;
let b: Fixture;
beforeEach(async () => {
  a = await fixture(); b = await fixture();
  auth.session.mockResolvedValue({ user: { id: a.ctx.userId }, session: { activeOrganizationId: a.ctx.organizationId } });
}, TIMEOUT_MS);
afterEach(async () => { for (const f of [a, b]) if (f) await removeApiOrderReadFixture(f); }, TIMEOUT_MS);
const { input, post, mutate, saved, read, snapshot } = formulationRouteHarness(() => a, () => ({ description: null }));

const tools = ["create_formulation", "update_formulation", "delete_formulation", "archive_formulation", "restore_formulation"];
async function call(name: string, args: Record<string, unknown>, key = a.formulationKey) {
  const response = await MCP(rpc(key, "tools/call", { name, arguments: args }));
  expect(response.status).toBe(200);
  const body = await rpcBody(response);
  expect(body.error).toBeUndefined();
  return body.result;
}
const write = (name: string, args: Record<string, unknown>, key = a.formulationKey) => call(name, { requestKey: randomUUID(), ...args }, key);
const toolName = (command: Command) => `${command === "patch" ? "update" : command}_formulation`;
const appCommands = { delete: deleteFormulationFn, archive: archiveFormulationFn, restore: restoreFormulationFn };
const comparableRow = (row: FormulationRepresentation) => ({ ...domainFields(row), code: undefined });
async function events(id: string) {
  return db.select().from(activityEvents).where(eq(activityEvents.entityId, id)).orderBy(activityEvents.occurredAt);
}
async function compareEvents(ids: string[], operation: string) {
  const rows = await Promise.all(ids.map(async id => (await events(id)).filter(event => event.operationId === operation)));
  expect(rows.map(row => row.length)).toEqual([1, 1, 1]);
  expect(rows.map(row => row[0].source)).toEqual(["form", "rest", "mcp"]);
  expect(rows[0][0].credentialId).toBeNull();
  expect(rows[1][0].credentialId).toEqual(expect.any(String));
  expect(rows[2][0].credentialId).toBe(rows[1][0].credentialId);
  const effects = {
    create_formulation: { action: "created", versionBefore: null, versionAfter: 1, changedFields: ["biocharRatio", "description", "lines", "name"] },
    update_formulation: { action: "updated", versionBefore: 1, versionAfter: 2, changedFields: ["biocharRatio", "description", "lines", "name"] },
    archive_formulation: { action: "status_changed", versionBefore: 2, versionAfter: 3, changedFields: [], fromStatus: "active", toStatus: "archived" },
    restore_formulation: { action: "status_changed", versionBefore: 3, versionAfter: 4, changedFields: [], fromStatus: "archived", toStatus: "active" },
    delete_formulation: { action: "deleted", versionBefore: 4, versionAfter: null, changedFields: [] },
  };
  for (const [event] of rows) expect(event).toMatchObject(effects[operation as keyof typeof effects]);
  const normalize = (event: typeof rows[number][number]) => Object.fromEntries(
    Object.entries(event).filter(([key]) => !["id", "entityId", "occurredAt", "sequence", "source", "requestId", "credentialId"].includes(key)),
  );
  expect(normalize(rows[1][0])).toEqual(normalize(rows[0][0]));
  expect(normalize(rows[2][0])).toEqual(normalize(rows[0][0]));
}

describe("formulation three-way parity", { timeout: TIMEOUT_MS }, () => {
  it("creates from app percentages and API ratios, then updates, archives, restores and deletes with matching rows and Activity", async () => {
    const app = await createFormulationFn(percentFormToRatioPayload({ name: "Compost blend", biocharPercent: 70,
      description: "", ingredients: [{ feedstockTypeId: a.ingredientType.id, sharePercent: 30 }] }));
    expect(app.success).toBe(true);
    if (!app.success) throw new Error("App create refused");
    const rest = await saved();
    const mcp = await write("create_formulation", input());
    expect(mcp.isError).toBeUndefined();
    const ids = [app.data.id, rest.id, mcp.structuredContent.data.id];
    const rows = await Promise.all(ids.map(read));
    expect(comparableRow(rows[1])).toEqual(comparableRow(rows[0]));
    expect(comparableRow(rows[2])).toEqual(comparableRow(rows[0]));
    await compareEvents(ids, "create_formulation");
    for (const [command, version] of [["patch", 1], ["archive", 2], ["restore", 3], ["delete", 4]] as const) {
      const body = command === "patch" ? { name: "Changed blend", biocharRatio: 0.6, description: "Recipe guidance", lines: [{ feedstockTypeId: a.ingredientType.id, ratio: 0.4 }] } : {};
      const target = { formulationId: ids[0], expectedVersion: version };
      const action = command === "patch" ? await updateFormulationFn({ ...target, name: "Changed blend", biocharRatio: 0.6,
        description: "Recipe guidance", ingredients: [{ feedstockTypeId: a.ingredientType.id, ratio: 0.4 }] }) : await appCommands[command](target);
      expect(action.success).toBe(true);
      const response = await mutate(command, ids[1], body, `"${version}.2"`);
      expect(response.status).toBe(command === "delete" ? 204 : 200);
      const result = await write(toolName(command), { ...body, formulationId: ids[2], expectedVersion: version });
      expect(result.isError).toBeUndefined();
      if (command === "delete") {
        expect(result.structuredContent).toEqual({ deleted: { id: ids[2], code: rows[2].code } });
        for (const id of ids) expect((await GET(readRequest(`/formulations/${id}`, a.formulationKey), readParams(id))).status).toBe(404);
      } else {
        const appRow = await read(ids[0]);
        expect(appRow.version).toBe(version + 1);
        expect(comparableRow((await response.json()).data)).toEqual(comparableRow(appRow));
        expect(comparableRow(result.structuredContent.data)).toEqual(comparableRow(appRow));
        expect(result.structuredContent.data).toEqual(await read(ids[2]));
      }
      await compareEvents(ids, toolName(command));
    }
  });

  it.each(["create", ...commands] as const)("shares idempotency records in both directions for %s and replays historical outcomes", async command => {
    for (const first of ["rest", "mcp"] as const) {
      const row = command === "create" ? undefined : await saved();
      let version = 1;
      if (command === "restore") { await mutate("archive", row!.id); version = 2; }
      const body = command === "create" ? input() : command === "patch" ? { description: "Changed" } : {};
      const key = randomUUID();
      const args = { ...body, ...(row ? { formulationId: row.id, expectedVersion: version } : {}), requestKey: key };
      const name = command === "create" ? "create_formulation" : toolName(command);
      const restCall = () => command === "create" ? post(body, key) : mutate(command, row!.id, body, `"${version}.2"`, key);
      let original: Record<string, unknown>;
      if (first === "rest") {
        const response = await restCall();
        expect(response.status).toBe(command === "create" ? 201 : command === "delete" ? 204 : 200);
        original = command === "delete" ? { deleted: { id: row!.id, code: row!.code } } : await response.json();
      } else {
        const result = await call(name, args);
        expect(result.isError).toBeUndefined();
        original = result.structuredContent;
      }
      if (command === "archive" || command === "restore") {
        expect((await mutate(command === "archive" ? "restore" : "archive", row!.id, {}, `"${version + 1}.2"`)).status).toBe(200);
      }
      const before = await snapshot();
      const replay = await call(name, args);
      expect(replay.isError).toBeUndefined();
      expect(replay.structuredContent).toEqual(original);
      expect(replay.content[0].text).toMatch(/^Replayed:/);
      const restReplay = await restCall();
      expect(restReplay.headers.get("idempotent-replayed")).toBe("true");
      if (command !== "delete") expect(await restReplay.json()).toEqual(original);
      else expect(restReplay.status).toBe(204);
      expect(await snapshot()).toEqual(before);
      const records = await db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, a.ctx.organizationId));
      expect(records.filter(record => record.idempotencyKey === key)).toHaveLength(1);
      const changed = await call(name, { ...args, ...(command === "create" || command === "patch" ? { name: "Other" } : { expectedVersion: version + 1 }) });
      expect(changed).toMatchObject({ isError: true, structuredContent: { code: "idempotency_key_reused" } });
      expect(await snapshot()).toEqual(before);
    }
  });

  it.each(["create", ...commands] as const)("previews %s without changing rows, versions, lines, Activity or idempotency", async command => {
    const row = command === "create" ? undefined : await saved();
    let version = 1;
    if (command === "restore") { await mutate("archive", row!.id); version = 2; }
    const body = command === "create" ? input() : command === "patch" ? { description: "Preview" } : {};
    const before = await snapshot();
    const result = await call(command === "create" ? "create_formulation" : toolName(command), {
      ...body, ...(row ? { formulationId: row.id, expectedVersion: version } : {}), dryRun: true,
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.data.version).toBe(command === "create" ? 1 : command === "delete" ? version : version + 1);
    const response = command === "create" ? await post(body, randomUUID(), "?dryRun=true")
      : await mutate(command, row!.id, body, `"${version}.2"`, undefined, "?dryRun=true");
    expect(response.status).toBe(200);
    // Separate preview transactions generate their own UUIDs, codes and write instants.
    // Keep existing IDs, codes and unchanged timestamps in the comparison.
    const previewBody = (body: { data: FormulationRepresentation }) => ({ ...body, data: {
      ...body.data,
      ...(command === "create" ? { id: undefined, code: undefined, createdAt: undefined,
        lines: body.data.lines.map(line => ({ ...line, id: undefined })) } : {}),
      ...(command !== "delete" ? { updatedAt: undefined } : {}),
      ...(command === "archive" ? { archivedAt: body.data.archivedAt !== null } : {}),
    } });
    expect(previewBody(result.structuredContent)).toEqual(previewBody(await response.json()));
    expect(await snapshot()).toEqual(before);
  });
});

/** Run all three boundaries against the same target, keeping blocker ids and codes comparable. */
async function refusal(command: Command | "create", body: Record<string, unknown>, row: FormulationRepresentation | undefined,
  code: string, pointer?: string, version = row?.version ?? 1) {
  const before = await snapshot();
  const target = { formulationId: row?.id ?? "", expectedVersion: version };
  const { lines, ...fields } = body;
  // The form sends an empty string for a cleared description; APIs accept null.
  if (fields.description === null) fields.description = "";
  const ingredients = lines as { feedstockTypeId: string; ratio?: number }[] | undefined;
  const action = command === "create" ? await createFormulationFn({ name: "Refused", ...fields, ingredients })
    : command === "patch" ? await updateFormulationFn({ ...target, ...fields, ingredients }) : await appCommands[command](target);
  expect(action.success).toBe(false);
  if (action.success) throw new Error("App accepted refused input");
  const response = command === "create" ? await post(body) : await mutate(command, row!.id, body, `"${version}.2"`);
  const problem = await response.json();
  const result = await write(command === "create" ? "create_formulation" : toolName(command), { ...body, ...(row ? target : {}) });
  expect(result.isError).toBe(true);
  expect(action.code).toBe(code);
  expect(problem.code).toBe(code);
  expect(result.structuredContent.code).toBe(code);
  if (problem.current) expect(result.structuredContent.current).toEqual(problem.current);
  const issues = (action.issues ?? []).map(issue => ({ code: issue.code, pointer: jsonPointer(issue.path), meta: issue.meta }));
  const normalize = (items: { code: string; pointer?: string; meta?: unknown }[]) => items.map(({ code, pointer, meta }) => ({ code, pointer, meta }));
  expect(normalize(problem.errors)).toEqual(issues);
  expect(normalize(result.structuredContent.issues)).toEqual(issues);
  if (pointer) expect(issues).toContainEqual(expect.objectContaining({ pointer }));
  expect(await snapshot()).toEqual(before);
  return problem;
}

describe("formulation refusal parity and MCP isolation", { timeout: TIMEOUT_MS }, () => {
  it("matches duplicate code, non-blend type, archived type and merged ratio sum refusals", async () => {
    const row = await saved();
    await refusal("create", { ...input(), biocharRatio: 0.700001 }, undefined, "validation_failed", "/biocharRatio");
    await refusal("patch", { code: a.pure.code }, row, "conflict", "/code");
    const types = await db.select().from(feedstockTypes).where(eq(feedstockTypes.organizationId, a.ctx.organizationId));
    const pyrolysis = types.find(type => type.usage === "pyrolysis")!;
    for (const command of ["create", "patch"] as const) {
      await refusal(command, { name: "Refused", lines: [{ feedstockTypeId: pyrolysis.id, ratio: 0.3 }] }, command === "create" ? undefined : row,
        "validation_failed", "/lines/0/feedstockTypeId");
    }
    await refusal("patch", { lines: [{ feedstockTypeId: a.ingredientType.id, ratio: 0.300001 }] }, row, "validation_failed", "/biocharRatio");
    await db.update(feedstockTypes).set({ archivedAt: new Date() }).where(eq(feedstockTypes.id, a.ingredientType.id));
    await refusal("create", input(), undefined, "not_found", "/lines/0/feedstockTypeId");
    await refusal("patch", { lines: input().lines }, await read(a.pure.id), "not_found", "/lines/0/feedstockTypeId");
  });

  it("matches used-line removal and product, bin and archived-order delete references", async () => {
    await refusal("delete", {}, await read(a.recipe.id), "conflict", "/formulationId");
    const orderRow = await saved();
    const order = await insertReadOrder(a, "FORMULATION-ORDER", { formulationId: orderRow.id, archivedAt: new Date() });
    const blocked = await refusal("delete", {}, orderRow, "conflict", "/formulationId");
    expect(blocked.errors[0].meta).toEqual({ orderCodes: [order.code] });
    const made = await runOperation(makeBiocharProduct, a.ctx, {
      facilityId: a.facility.id, formulationId: a.recipe.id, placedAt: "2026-09-12T12:00:00.000Z",
      sourceBiocharStorageLocationId: a.source.id, storageLocationId: a.bin.id,
      biocharWetMassKg: 100, biocharMoisturePercent: 10, waterAddedKg: 0,
      ingredients: [{ formulationIngredientId: a.ingredient.id, storageLocationId: null, wetMassKg: 1, moisturePercent: 0 }],
    });
    const recipe = await read(a.recipe.id);
    const removal = await refusal("patch", { lines: [] }, recipe, "conflict", "/lines");
    expect(removal.errors[0].meta).toEqual({ formulationIngredientId: a.ingredient.id, feedstockTypeId: a.ingredientType.id, productCodes: [made.data.product.code] });
    const deletion = await refusal("delete", {}, recipe, "conflict", "/formulationId");
    expect(deletion.errors[0].meta).toEqual({ productCodes: [made.data.product.code] });
  });

  it("matches stale versions, archived PATCH before stale version and repeated archive", async () => {
    const row = await saved();
    await mutate("patch", row.id, { description: "Changed" });
    for (const command of commands) await refusal(command, command === "patch" ? { name: "Refused" } : {}, row, "stale_version");
    await mutate("archive", row.id, {}, '"2.2"');
    const archived = await read(row.id);
    for (const version of [1, archived.version]) await refusal("patch", { name: "Refused" }, archived, "not_found", "/formulationId", version);
    await refusal("archive", {}, archived, "conflict", "/formulationId");
    await refusal("archive", {}, archived, "stale_version", undefined, 2);
  });

  it("hides each tool without its scope, including archive and restore for delete-only keys", async () => {
    for (const [key, allowed] of [[a.readKey, []], [a.writeKey, tools.filter(name => name !== "delete_formulation")], [a.deleteKey, ["delete_formulation"]]] as const) {
      const listing = await rpcBody(await MCP(rpc(key, "tools/list")));
      const names = listing.result.tools.map((tool: { name: string }) => tool.name);
      const before = await snapshot();
      for (const name of tools) {
        expect(names.includes(name)).toBe((allowed as readonly string[]).includes(name));
        if ((allowed as readonly string[]).includes(name)) continue;
        const hidden = await rpcBody(await MCP(rpc(key, "tools/call", { name, arguments: { formulationId: b.pure.id, expectedVersion: 1, requestKey: randomUUID() } })));
        const unknown = await rpcBody(await MCP(rpc(key, "tools/call", { name: "unknown_tool", arguments: {} })));
        expect(hidden.error).toEqual(unknown.error);
        expect(hidden.result).toBeUndefined();
      }
      expect(await snapshot()).toEqual(before);
    }
  });

  it("answers not_found for foreign formulations and line types and writes nothing in either organization", async () => {
    const row = await saved();
    const before = await snapshot();
    const foreignBefore = await snapshot(b);
    for (const command of commands) {
      expect(await write(toolName(command), { formulationId: b.pure.id, expectedVersion: 1 }))
        .toMatchObject({ isError: true, structuredContent: { code: "not_found", issues: [{ pointer: "/formulationId" }] } });
    }
    const lines = [{ feedstockTypeId: b.ingredientType.id, ratio: 0.3 }];
    for (const [name, args] of [["create_formulation", { ...input(), lines }], ["update_formulation", { formulationId: row.id, expectedVersion: 1, lines }]] as const) {
      expect(await write(name, args)).toMatchObject({ isError: true, structuredContent: { code: "not_found", issues: [{ pointer: "/lines/0/feedstockTypeId" }] } });
    }
    expect(await snapshot()).toEqual(before);
    expect(await snapshot(b)).toEqual(foreignBefore);
  });

  it("finds archived formulations only with archived: true and refuses changed cursor bindings", async () => {
    const first = await saved();
    await saved();
    const page = await call("find_formulations", { limit: 1 });
    expect(page.structuredContent.nextCursor).toEqual(expect.any(String));
    await mutate("archive", first.id);
    expect((await call("find_formulations", { code: first.code })).structuredContent.data).toEqual([]);
    expect((await call("find_formulations", { code: first.code, archived: true })).structuredContent.data).toEqual([await read(first.id)]);
    const cursor = page.structuredContent.nextCursor;
    const restRefusal = await LIST(readRequest(`/formulations?cursor=${cursor}&archived=true`, a.formulationKey));
    expect(restRefusal.status).toBe(400);
    const problem = await restRefusal.json();
    expect(await call("find_formulations", { cursor, archived: true }))
      .toMatchObject({ isError: true, structuredContent: { code: problem.code, issues: problem.errors } });
    const archivedList = await LIST(readRequest(`/formulations?code=${first.code}&archived=true`, a.formulationKey));
    expect((await call("find_formulations", { code: first.code, archived: true })).structuredContent).toEqual(await archivedList.json());
  });
});
