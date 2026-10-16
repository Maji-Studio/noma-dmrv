import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, apiIdempotencyRecords, formulations, formulationIngredients, feedstockTypes } from "@/db/schema";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { createFormulationFn, updateFormulationFn } from "@/fn/formulations";
import { jsonPointer } from "@/lib/api/problem";
import { makeBiocharProduct } from "@/lib/operations/biochar-products";
import { runOperation } from "@/lib/operations/runner";
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { POST } from "@/app/api/v1/formulations/route";
import { GET, PATCH, DELETE } from "@/app/api/v1/formulations/[idOrCode]/route";
import { POST as ARCHIVE } from "@/app/api/v1/formulations/[idOrCode]/archive/route";
import { POST as RESTORE } from "@/app/api/v1/formulations/[idOrCode]/restore/route";
import { formulationRepresentationSchema, type FormulationRepresentation } from "@/lib/representations/formulations";
import { createApiOrderReadFixture, insertReadOrder, removeApiOrderReadFixture, readParams, readRequest } from "./helpers/api-order-read-fixture";

// Only the request-session boundary is simulated. Both transports resolve real org membership.
const auth = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/auth/providers/better-auth-server", async original => ({
  ...await original<typeof import("@/lib/auth/providers/better-auth-server")>(), getBetterAuthSession: auth.session,
}));

const TIMEOUT_MS = 60_000;
const INITIAL_ETAG = '"1.2"';
type Fixture = Awaited<ReturnType<typeof fixture>>;
let a: Fixture;
let b: Fixture;
async function fixture() {
  const f = await createApiOrderReadFixture();
  const key = async (scopes: ApiScope[]) => (await createApiKey(f.ctx, { name: "Formulation route fixture", scopes, expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key;
  return { ...f, formulationKey: await key(["formulations:write", "formulations:read", "formulations:delete"]),
    readKey: await key(["formulations:read"]), writeKey: await key(["formulations:write"]), deleteKey: await key(["formulations:delete"]) };
}
beforeEach(async () => {
  a = await fixture(); b = await fixture();
  auth.session.mockResolvedValue({ user: { id: a.ctx.userId }, session: { activeOrganizationId: a.ctx.organizationId } });
}, TIMEOUT_MS);
afterEach(async () => { for (const f of [a, b]) if (f) await removeApiOrderReadFixture(f); }, TIMEOUT_MS);
function request(method: string, suffix: string, body?: unknown, headers: Record<string, string> = {}, credential = a.formulationKey) {
  return new Request(`http://localhost:3100/api/v1/formulations${suffix}`, { method, headers: {
    authorization: `Bearer ${credential}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers,
  }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const input = () => ({ name: "Compost blend", biocharRatio: 0.7, lines: [{ feedstockTypeId: a.ingredientType.id, ratio: 0.3 }] });
const post = (body: unknown = input(), key: string | null = randomUUID(), query = "") => POST(request("POST", query, body, key ? { "idempotency-key": key } : {}));
type Command = "patch" | "delete" | "archive" | "restore";
const commands: Command[] = ["patch", "delete", "archive", "restore"];
function mutate(command: Command, id: string, body?: unknown, tag: string | null = INITIAL_ETAG, key?: string, query = "", credential = a.formulationKey) {
  const method = command === "patch" ? "PATCH" : command === "delete" ? "DELETE" : "POST";
  const suffix = command === "archive" || command === "restore" ? `/${command}` : "";
  const handler = { patch: PATCH, delete: DELETE, archive: ARCHIVE, restore: RESTORE }[command];
  return handler(request(method, `/${id}${suffix}${query}`, body, {
    ...(tag ? { "if-match": tag } : {}), ...(key ? { "idempotency-key": key } : {}),
  }, credential), readParams(id));
}
async function saved(body: unknown = input()) {
  const response = await post(body);
  expect(response.status).toBe(201);
  return (await response.json()).data as FormulationRepresentation;
}
async function read(id: string) {
  const response = await GET(readRequest(`/formulations/${id}`, a.formulationKey), readParams(id));
  expect(response.status).toBe(200);
  return (await response.json()).data as FormulationRepresentation;
}
async function problem(response: Response, status: number, code: string, pointer?: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/problem+json");
  const body = await response.json();
  expect(body.code).toBe(code);
  if (pointer) expect(body.errors).toContainEqual(expect.objectContaining({ pointer }));
  return body;
}
async function snapshot(f = a) {
  const organizationId = f.ctx.organizationId;
  return Promise.all([
    db.select().from(formulations).where(eq(formulations.organizationId, organizationId)).orderBy(formulations.id),
    db.select().from(formulationIngredients).where(eq(formulationIngredients.organizationId, organizationId)).orderBy(formulationIngredients.id),
    db.select().from(activityEvents).where(eq(activityEvents.organizationId, organizationId)).orderBy(activityEvents.id),
    db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, organizationId)).orderBy(apiIdempotencyRecords.id),
  ]);
}
/** UUIDs and event instants are provisional on a rollback; every domain field must match. */
function domainFields(row: FormulationRepresentation) {
  return { ...row, id: undefined, createdAt: undefined, updatedAt: undefined, archivedAt: row.archivedAt !== null,
    lines: row.lines.map(line => ({ feedstockTypeId: line.feedstockTypeId, ratio: line.ratio })) };
}

describe("formulation REST writes", { timeout: TIMEOUT_MS }, () => {
  it("creates the revision 2 representation with its GET ETag and Location", async () => {
    const response = await post();
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(formulationRepresentationSchema.parse(body.data)).toEqual(body.data);
    expect(body.data).toMatchObject({ name: "Compost blend", version: 1, archivedAt: null, biocharRatio: 0.7, lines: [{ feedstockTypeId: a.ingredientType.id, ratio: 0.3 }] });
    expect(response.headers.get("etag")).toBe(INITIAL_ETAG);
    expect(response.headers.get("location")).toBe(`/api/v1/formulations/${body.data.id}`);
    const read = await GET(readRequest(`/formulations/${body.data.id}`, a.formulationKey), readParams(body.data.id));
    expect(await read.json()).toEqual(body);
    expect(read.headers.get("etag")).toBe(INITIAL_ETAG);
    expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, body.data.id)))
      .toMatchObject([{ operationId: "create_formulation", action: "created", source: "rest" }]);
  });
  it("updates by UUID with a strong precondition and returns the current representation on stale versions", async () => {
    const { data } = await (await post()).json();
    const patch = (tag?: string) => PATCH(request("PATCH", `/${data.id.toUpperCase()}`, { name: "Changed blend" }, tag ? { "if-match": tag } : {}), readParams(data.id.toUpperCase()));
    expect((await patch()).status).toBe(428);
    const changed = await patch(INITIAL_ETAG);
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).toBe('"2.2"');
    const saved = await changed.json();
    expect(saved.data).toMatchObject({ id: data.id, version: 2, name: "Changed blend" });
    expect(saved.data.lines).toEqual(data.lines);
    const stale = await patch(INITIAL_ETAG);
    expect(stale.status).toBe(412);
    expect(await stale.json()).toMatchObject({ code: "stale_version", current: saved.data });
  });
  it("archives, restores and deletes with revision 2 preconditions, refusing repeat transitions", async () => {
    const { data } = await (await post()).json();
    const command = (handler: typeof ARCHIVE, suffix: string, tag?: string, body?: unknown) => handler(
      request("POST", `/${data.id}/${suffix}`, body, tag ? { "if-match": tag } : {}), readParams(data.id));
    for (const [handler, suffix] of [[ARCHIVE, "archive"], [RESTORE, "restore"]] as const) {
      expect((await command(handler, suffix)).status).toBe(428);
    }
    const archived = await command(ARCHIVE, "archive", INITIAL_ETAG);
    expect(archived.status).toBe(200);
    expect(archived.headers.get("etag")).toBe('"2.2"');
    const archivedBody = await archived.json();
    expect(archivedBody.data).toMatchObject({ version: 2, archivedAt: expect.any(String) });
    const repeat = await command(ARCHIVE, "archive", '"2.2"', {});
    expect(repeat.status).toBe(409);
    expect(await repeat.json()).toMatchObject({ code: "conflict" });
    const restored = await command(RESTORE, "restore", '"2.2"', {});
    expect(restored.status).toBe(200);
    expect(restored.headers.get("etag")).toBe('"3.2"');
    expect((await restored.json()).data).toMatchObject({ version: 3, archivedAt: null });
    await problem(await command(RESTORE, "restore", '"3.2"'), 409, "conflict", "/formulationId");
    const missing = await DELETE(request("DELETE", `/${data.id}`), readParams(data.id));
    expect(missing.status).toBe(428);
    const removed = await DELETE(request("DELETE", `/${data.id}`, undefined, { "if-match": '"3.2"' }), readParams(data.id));
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe("");
    expect(removed.headers.has("etag")).toBe(false);
  });

  it("requires a create key even for dry runs, and returns a matching preview without saving row, lines, Activity or key", async () => {
    for (const query of ["", "?dryRun=true"]) await problem(await post(input(), null, query), 400, "idempotency_key_required");
    const before = await snapshot();
    const key = randomUUID();
    const preview = await post(input(), key, "?dryRun=true");
    expect(preview.status).toBe(200);
    expect(preview.headers.get("dry-run")).toBe("true");
    expect(preview.headers.has("etag")).toBe(false);
    expect(preview.headers.has("location")).toBe(false);
    const previewRow = (await preview.json()).data;
    expect(await snapshot()).toEqual(before);
    const committed = await savedWithKey(input(), key);
    expect(domainFields(previewRow)).toEqual(domainFields(committed));
    await problem(await post(input(), key, "?dryRun=true"), 409, "key_already_used");
  });

  it("replays byte-identical create bodies through the real builder and refuses changed input", async () => {
    const key = randomUUID();
    const original = await post(input(), key);
    const text = await original.text();
    const before = await snapshot();
    const replay = await post({ lines: input().lines, biocharRatio: 0.7, name: "Compost blend" }, key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.headers.get("etag")).toBe(INITIAL_ETAG);
    expect(replay.headers.get("location")).toBe(original.headers.get("location"));
    expect(await replay.text()).toBe(text);
    await problem(await post({ ...input(), name: "Different blend" }, key), 422, "idempotency_key_reused");
    expect(await snapshot()).toEqual(before);
  });

  it.each(commands)("requires If-Match and returns the current representation for either stale %s precondition", async command => {
    const row = await saved();
    const body = command === "patch" ? { description: "New guidance" } : undefined;
    await problem(await mutate(command, row.id, body, null), 428, "precondition_required");
    const before = await snapshot();
    for (const tag of ['"9.2"', '"1.1"']) {
      const refusal = await problem(await mutate(command, row.id, body, tag), 412, "stale_version");
      expect(refusal.current).toEqual(row);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("refuses archived PATCH before stale row versions and stale representation revisions", async () => {
    const row = await saved();
    expect((await mutate("archive", row.id)).status).toBe(200);
    const before = await snapshot();
    for (const tag of [INITIAL_ETAG, '"2.1"', '"2.2"']) {
      await problem(await mutate("patch", row.id, { name: "Refused" }, tag), 404, "not_found", "/formulationId");
    }
    expect(await snapshot()).toEqual(before);
  });

  it.each(commands)("previews %s with no committed headers, then commits the same domain result", async command => {
    const row = await saved();
    let tag = INITIAL_ETAG;
    if (command === "restore") { await mutate("archive", row.id); tag = '"2.2"'; }
    const before = await snapshot();
    const body = command === "patch" ? { biocharRatio: 0, description: null, lines: [] } : {};
    const preview = await mutate(command, row.id, body, tag, randomUUID(), "?dryRun=true");
    expect(preview.status).toBe(200);
    expect(preview.headers.get("dry-run")).toBe("true");
    expect(preview.headers.has("etag")).toBe(false);
    expect(preview.headers.has("location")).toBe(false);
    const previewBody = await preview.json();
    expect(await snapshot()).toEqual(before);
    const committed = await mutate(command, row.id, body, tag);
    if (command === "delete") {
      expect(previewBody.data).toEqual(row);
      expect(committed.status).toBe(204);
      expect(await committed.text()).toBe("");
    } else {
      expect(committed.status).toBe(200);
      expect(committed.headers.get("etag")).toBe(command === "restore" ? '"3.2"' : '"2.2"');
      expect(domainFields((await committed.json()).data)).toEqual(domainFields(previewBody.data));
    }
  });

  it.each(commands)("replays %s before preconditions even after later state changes or deletion", async command => {
    const row = await saved();
    let tag = INITIAL_ETAG;
    if (command === "restore") { await mutate("archive", row.id); tag = '"2.2"'; }
    const key = randomUUID();
    const body = command === "patch" ? { name: "Renamed blend" } : {};
    const original = await mutate(command, row.id, body, tag, key);
    expect(original.status).toBe(command === "delete" ? 204 : 200);
    const text = await original.text();
    if (command !== "delete") {
      const nextTag = command === "restore" ? '"3.2"' : '"2.2"';
      expect((await mutate(command === "archive" ? "restore" : "archive", row.id, {}, nextTag)).status).toBe(200);
    }
    const before = await snapshot();
    const replay = await mutate(command, row.id.toUpperCase(), body, tag, key);
    expect(replay.status).toBe(original.status);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.headers.get("etag")).toBe(original.headers.get("etag"));
    expect(await replay.text()).toBe(text);
    expect(await snapshot()).toEqual(before);
  });

  it("checks transition versions before state and allows deleting an unused archived formulation", async () => {
    const row = await saved();
    const archived = await mutate("archive", row.id);
    const current = (await archived.json()).data;
    expect((await problem(await mutate("archive", row.id), 412, "stale_version")).current).toEqual(current);
    await problem(await mutate("archive", row.id, {}, '"2.2"'), 409, "conflict", "/formulationId");
    expect((await mutate("delete", row.id, undefined, '"2.2"')).status).toBe(204);
  });

  it.each([false, true])("refuses order-referenced deletes with scoped blocker metadata, archived order: %s", async archived => {
    const row = await saved();
    const order = await insertReadOrder(a, "FORMULATION-ORDER", { formulationId: row.id, archivedAt: archived ? new Date() : null });
    const before = await snapshot();
    const refusal = await problem(await mutate("delete", row.id), 409, "conflict", "/formulationId");
    expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: "/formulationId", meta: { orderCodes: [order.code] } }));
    expect(await snapshot()).toEqual(before);
  });

  it("maps bin and product blockers and used-line removal to conflict metadata", async () => {
    const binRefusal = await problem(await mutate("delete", a.recipe.id), 409, "conflict", "/formulationId");
    expect(binRefusal.errors).toContainEqual(expect.objectContaining({ meta: { binCodes: [a.bin.code] } }));
    const made = await runOperation(makeBiocharProduct, a.ctx, {
      facilityId: a.facility.id, formulationId: a.recipe.id, placedAt: "2026-09-12T12:00:00.000Z",
      sourceBiocharStorageLocationId: a.source.id, storageLocationId: a.bin.id,
      biocharWetMassKg: 100, biocharMoisturePercent: 10, waterAddedKg: 0,
      ingredients: [{ formulationIngredientId: a.ingredient.id, storageLocationId: null, wetMassKg: 1, moisturePercent: 0 }],
    });
    const before = await snapshot();
    const productCodes = [made.data.product.code];
    const deletion = await problem(await mutate("delete", a.recipe.id), 409, "conflict", "/formulationId");
    expect(deletion.errors).toContainEqual(expect.objectContaining({ meta: { productCodes } }));
    const removal = await problem(await mutate("patch", a.recipe.id, { lines: [] }), 409, "conflict", "/lines");
    expect(removal.errors).toContainEqual(expect.objectContaining({ meta: {
      formulationIngredientId: a.ingredient.id, feedstockTypeId: a.ingredientType.id, productCodes,
    } }));
    expect(await snapshot()).toEqual(before);
  });

  it("requires formulation write or delete scope on every actual route", async () => {
    const row = await saved();
    const before = await snapshot();
    await problem(await POST(request("POST", "", input(), { "idempotency-key": randomUUID() }, a.readKey)), 403, "missing_scope");
    for (const command of commands) await problem(await mutate(command, row.id, command === "patch" ? {} : undefined, INITIAL_ETAG, undefined, "", a.readKey), 403, "missing_scope");
    await problem(await mutate("delete", row.id, undefined, INITIAL_ETAG, undefined, "", a.writeKey), 403, "missing_scope");
    for (const command of ["patch", "archive", "restore"] as const) await problem(await mutate(command, row.id, {}, INITIAL_ETAG, undefined, "", a.deleteKey), 403, "missing_scope");
    expect(await snapshot()).toEqual(before);
  });

  it("hides foreign path ids and body references without writing either organization", async () => {
    const row = await saved();
    const before = await snapshot();
    const foreignBefore = await snapshot(b);
    for (const command of commands) await problem(await mutate(command, b.pure.id, command === "patch" ? { name: "Foreign" } : undefined), 404, "not_found", "/formulationId");
    const foreignInput = { ...input(), lines: [{ feedstockTypeId: b.ingredientType.id, ratio: 0.3 }] };
    await problem(await post(foreignInput), 404, "not_found", "/lines/0/feedstockTypeId");
    await problem(await mutate("patch", row.id, { lines: foreignInput.lines }), 404, "not_found", "/lines/0/feedstockTypeId");
    expect(await snapshot()).toEqual(before);
    expect(await snapshot(b)).toEqual(foreignBefore);
  });

  it.each(commands)("refuses a formulation code on %s without writing", async command => {
    const row = await saved();
    let tag = INITIAL_ETAG;
    if (command === "restore") {
      const archived = await mutate("archive", row.id);
      expect(archived.status).toBe(200);
      tag = archived.headers.get("etag")!;
    }
    const before = await snapshot();
    await problem(await mutate(command, row.code, command === "patch" ? { name: "Changed by code" } : undefined, tag), 404, "not_found", "/formulationId");
    expect(await snapshot()).toEqual(before);
  });

  it("checks write scopes before parsing malformed JSON on every write route", async () => {
    const row = await saved();
    const before = await snapshot();
    const malformed = (method: string, suffix: string, headers: Record<string, string>) =>
      new Request(request(method, suffix, {}, headers, a.readKey), { body: "{" });
    await problem(await POST(malformed("POST", "", { "idempotency-key": randomUUID() })), 403, "missing_scope");
    for (const command of commands) {
      const method = command === "patch" ? "PATCH" : command === "delete" ? "DELETE" : "POST";
      const suffix = command === "archive" || command === "restore" ? `/${command}` : "";
      const handler = { patch: PATCH, delete: DELETE, archive: ARCHIVE, restore: RESTORE }[command];
      await problem(await handler(malformed(method, `/${row.id}${suffix}`, { "if-match": INITIAL_ETAG }), readParams(row.id)), 403, "missing_scope");
    }
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    [{ extra: true }, "/extra"],
    [{ code: "BCF-CALLER" }, "/code"],
    [{ lines: [{ feedstockTypeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", extra: true }] }, "/lines/0/extra"],
    [{ lines: [{ feedstockTypeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ratio: 0.3333333 }] }, "/lines/0/ratio"],
    [{ biocharRatio: 0.700001 }, "/biocharRatio"],
  ])("refuses strict create input %j with its pointer", async (extra, pointer) => {
    const before = await snapshot();
    await problem(await post({ ...input(), ...extra }), 422, "validation_failed", pointer);
    expect(await snapshot()).toEqual(before);
  });

  it("refuses unknown PATCH keys and nonempty command bodies at their pointers", async () => {
    const row = await saved();
    const before = await snapshot();
    for (const field of ["formulationId", "expectedVersion", "extra"]) await problem(await mutate("patch", row.id, { [field]: true }), 422, "validation_failed", `/${field}`);
    await problem(await mutate("patch", row.id, { lines: [{ feedstockTypeId: a.ingredientType.id, extra: true }] }), 422, "validation_failed", "/lines/0/extra");
    for (const command of ["delete", "archive", "restore"] as const) {
      await problem(await mutate(command, row.id, { extra: true }), 422, "validation_failed", "/extra");
      for (const body of [null, [], true]) await problem(await mutate(command, row.id, body), 422, "validation_failed");
    }
    expect(await snapshot()).toEqual(before);
  });

  it("maps duplicate codes, non-blend types, archived types and merged ratios to typed refusals", async () => {
    const row = await saved();
    const types = await db.select().from(feedstockTypes).where(eq(feedstockTypes.organizationId, a.ctx.organizationId));
    const pyrolysisType = types.find(type => type.usage === "pyrolysis")!;
    const before = await snapshot();
    await problem(await mutate("patch", row.id, { code: a.pure.code }), 409, "conflict", "/code");
    await problem(await post({ ...input(), lines: [{ feedstockTypeId: pyrolysisType.id, ratio: 0.3 }] }), 422, "validation_failed", "/lines/0/feedstockTypeId");
    await problem(await mutate("patch", row.id, { lines: [{ feedstockTypeId: a.ingredientType.id, ratio: 0.300001 }] }), 422, "validation_failed", "/biocharRatio");
    expect(await snapshot()).toEqual(before);
    await db.update(feedstockTypes).set({ archivedAt: new Date() }).where(eq(feedstockTypes.id, a.ingredientType.id));
    await problem(await post(), 404, "not_found", "/lines/0/feedstockTypeId");
    expect((await mutate("patch", row.id, { lines: input().lines })).status).toBe(200);
  });

  it("matches app create and update rows, versions and typed refusal pointers", async () => {
    const rest = await saved();
    const action = await createFormulationFn({ name: "Compost blend", biocharRatio: 0.7, ingredients: input().lines });
    expect(action.success).toBe(true);
    if (!action.success) throw new Error("App create failed");
    const app = await read(action.data.id);
    expect({ ...domainFields(app), code: undefined }).toEqual({ ...domainFields(rest), code: undefined });
    const restChanged = await mutate("patch", rest.id, { biocharRatio: 0, description: "Changed", lines: [] });
    const actionChanged = await updateFormulationFn({ formulationId: app.id, expectedVersion: 1, biocharRatio: 0, description: "Changed", ingredients: [] });
    expect(actionChanged.success).toBe(true);
    const appChanged = await read(app.id);
    expect(appChanged.version).toBe(2);
    expect({ ...domainFields(appChanged), code: undefined }).toEqual({ ...domainFields((await restChanged.json()).data), code: undefined });
    for (const mode of ["create", "update"] as const) {
      const foreignLines = [{ feedstockTypeId: b.ingredientType.id, ratio: 0.3 }];
      const refusal = mode === "create" ? await createFormulationFn({ name: "Foreign blend", ingredients: foreignLines })
        : await updateFormulationFn({ formulationId: app.id, expectedVersion: 2, ingredients: foreignLines });
      expect(refusal.success).toBe(false);
      if (refusal.success) throw new Error("App accepted foreign type");
      const restRefusal = await problem(mode === "create" ? await post({ name: "Foreign blend", lines: foreignLines })
        : await mutate("patch", rest.id, { lines: foreignLines }, '"2.2"'), 404, "not_found", "/lines/0/feedstockTypeId");
      expect(refusal.code).toBe(restRefusal.code);
      expect(refusal.issues?.map(issue => ({ pointer: jsonPointer(issue.path), code: issue.code })))
        .toEqual(restRefusal.errors.map((issue: { pointer: string; code: string }) => ({ pointer: issue.pointer, code: issue.code })));
    }
  });
});

async function savedWithKey(body: unknown, key: string) {
  const response = await post(body, key);
  expect(response.status).toBe(201);
  return (await response.json()).data as FormulationRepresentation;
}
