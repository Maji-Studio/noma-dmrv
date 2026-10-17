import { POST as MCP } from "@/app/api/mcp/route";
import { rpc, rpcBody } from "./helpers/mcp";
import { jsonPointer } from "@/lib/api/problem";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, notExists } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, apiIdempotencyRecords, suppliers, customers, supplierLocations, customerLocations, supplierLocationFacilityDistances, customerLocationFacilityDistances, certifierProjects, certifierStorageLocations, feedstocks } from "@/db/schema";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import * as supplierCollection from "@/app/api/v1/suppliers/route";
import * as supplierItem from "@/app/api/v1/suppliers/[idOrCode]/route";
import { POST as supplierArchive } from "@/app/api/v1/suppliers/[idOrCode]/archive/route";
import { POST as supplierRestore } from "@/app/api/v1/suppliers/[idOrCode]/restore/route";
import * as customerCollection from "@/app/api/v1/customers/route";
import * as customerItem from "@/app/api/v1/customers/[idOrCode]/route";
import { POST as customerArchive } from "@/app/api/v1/customers/[idOrCode]/archive/route";
import { POST as customerRestore } from "@/app/api/v1/customers/[idOrCode]/restore/route";
import { supplierRepresentationSchema } from "@/lib/representations/suppliers";
import { customerRepresentationSchema } from "@/lib/representations/customers";
import { createSupplierWithLocationsFn, updateSupplierFn, deleteSupplierFn, archiveSupplierFn, restoreSupplierFn } from "@/fn/suppliers";
import { createCustomerWithLocationsFn, updateCustomerFn, deleteCustomerFn, archiveCustomerFn, restoreCustomerFn } from "@/fn/customers";
import { createApiOrderReadFixture, insertReadDelivery, insertReadOrder, removeApiOrderReadFixture, readParams, readRequest } from "./helpers/api-order-read-fixture";

const auth = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/auth/providers/better-auth-server", async original => ({
  ...await original<typeof import("@/lib/auth/providers/better-auth-server")>(), getBetterAuthSession: auth.session,
}));
const TIMEOUT_MS = 60_000;
const INITIAL_ETAG = '"1.2"';
type Kind = "supplier" | "customer";
type Command = "patch" | "delete" | "archive" | "restore";
const commands: Command[] = ["patch", "delete", "archive", "restore"];
const adapters = {
  supplier: { collection: supplierCollection, item: supplierItem, archive: supplierArchive, restore: supplierRestore, schema: supplierRepresentationSchema },
  customer: { collection: customerCollection, item: customerItem, archive: customerArchive, restore: customerRestore, schema: customerRepresentationSchema },
};
type Fixture = Awaited<ReturnType<typeof fixture>>;
let a: Fixture;
let b: Fixture;
let fixtures: Fixture[];
async function fixture() {
  const f = await createApiOrderReadFixture();
  const key = async (scopes: ApiScope[]) => (await createApiKey(f.ctx, { name: "Party route fixture", scopes, expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key;
  return { ...f, key, partyKey: await key(["suppliers:read", "suppliers:write", "suppliers:delete", "customers:read", "customers:write", "customers:delete"]) };
}
beforeEach(async () => {
  fixtures = [];
  a = await fixture(); fixtures.push(a);
  b = await fixture(); fixtures.push(b);
  auth.session.mockResolvedValue({ user: { id: a.ctx.userId }, session: { activeOrganizationId: a.ctx.organizationId } });
}, TIMEOUT_MS);
afterEach(async () => {
  for (const f of fixtures) if (f) {
    await db.delete(certifierStorageLocations).where(eq(certifierStorageLocations.organizationId, f.ctx.organizationId));
    await db.delete(certifierProjects).where(eq(certifierProjects.organizationId, f.ctx.organizationId));
    await db.delete(supplierLocationFacilityDistances).where(eq(supplierLocationFacilityDistances.organizationId, f.ctx.organizationId));
    await db.delete(customerLocationFacilityDistances).where(eq(customerLocationFacilityDistances.organizationId, f.ctx.organizationId));
    await db.delete(supplierLocations).where(eq(supplierLocations.organizationId, f.ctx.organizationId));
    await db.delete(suppliers).where(and(eq(suppliers.organizationId, f.ctx.organizationId),
      notExists(db.select({ id: feedstocks.id }).from(feedstocks).where(eq(feedstocks.supplierId, suppliers.id)))));
    await removeApiOrderReadFixture(f);
  }
}, TIMEOUT_MS);
function request(kind: Kind, method: string, suffix: string, body?: unknown, headers: Record<string, string> = {}, credential = a.partyKey) {
  return new Request(`http://localhost:3100/api/v1/${kind}s${suffix}`, { method, headers: {
    authorization: `Bearer ${credential}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers,
  }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const location = () => ({ name: "Main site", country: "Tanzania", gpsLatitude: -8, gpsLongitude: 34, isDefault: true,
  facilityDistances: [{ facilityId: a.facility.id, distanceKm: 12.5, distanceSource: "manual" as const }] });
const input = (kind: Kind) => ({ name: `New ${kind} ${randomUUID()}`, ...(kind === "supplier" ? { sourceRegion: "Mbeya" } : { cropType: "Coffee" }), locations: [{ ...location(), ...(kind === "customer" ? { siteDescription: "North field", defaultSoilTemperatureC: 0 } : {}) }] });
function post(kind: Kind, body: unknown = input(kind), key: string | null = randomUUID(), query = "") {
  return adapters[kind].collection.POST(request(kind, "POST", query, body, key ? { "idempotency-key": key } : {}));
}
function mutate(kind: Kind, command: Command, id: string, body?: unknown, tag: string | null = INITIAL_ETAG, key?: string, query = "", credential = a.partyKey) {
  const method = command === "patch" ? "PATCH" : command === "delete" ? "DELETE" : "POST";
  const suffix = command === "archive" || command === "restore" ? `/${command}` : "";
  const adapter = adapters[kind];
  const handler = { patch: adapter.item.PATCH, delete: adapter.item.DELETE, archive: adapter.archive, restore: adapter.restore }[command];
  return handler(request(kind, method, `/${id}${suffix}${query}`, body, {
    ...(tag ? { "if-match": tag } : {}), ...(key ? { "idempotency-key": key } : {}),
  }, credential), readParams(id));
}
async function saved(kind: Kind, body: unknown = input(kind)) {
  const response = await post(kind, body);
  expect(response.status).toBe(201);
  return await response.json() as { data: { id: string; code: string; name: string; version: number }; locations: { id: string; version: number }[] };
}
async function snapshot(f = a) {
  const org = f.ctx.organizationId;
  return Promise.all([
    db.select().from(suppliers).where(eq(suppliers.organizationId, org)).orderBy(suppliers.id),
    db.select().from(customers).where(eq(customers.organizationId, org)).orderBy(customers.id),
    db.select().from(supplierLocations).where(eq(supplierLocations.organizationId, org)).orderBy(supplierLocations.id),
    db.select().from(customerLocations).where(eq(customerLocations.organizationId, org)).orderBy(customerLocations.id),
    db.select().from(supplierLocationFacilityDistances).where(eq(supplierLocationFacilityDistances.organizationId, org)).orderBy(supplierLocationFacilityDistances.locationId, supplierLocationFacilityDistances.facilityId),
    db.select().from(customerLocationFacilityDistances).where(eq(customerLocationFacilityDistances.organizationId, org)).orderBy(customerLocationFacilityDistances.locationId, customerLocationFacilityDistances.facilityId),
    db.select().from(activityEvents).where(eq(activityEvents.organizationId, org)).orderBy(activityEvents.id),
    db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, org)).orderBy(apiIdempotencyRecords.id),
  ]);
}

function domainFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(domainFields);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["id", "code", "supplierId", "customerId", "createdAt", "updatedAt", "organizationId", "userId", "facilityId"].includes(key))
    .map(([key, field]) => [key, key === "archivedAt" ? field !== null : domainFields(field)]));
  return value;
}


type Row = { id: string; code: string; name: string; version: number };
const target = (kind: Kind, id: string, expectedVersion: number) => kind === "supplier" ? { supplierId: id, expectedVersion } : { customerId: id, expectedVersion };
const toolName = (kind: Kind, command: Command | "create") => `${command === "patch" ? "update" : command}_${kind}`;
async function call(name: string, args: Record<string, unknown>) {
  const response = await MCP(rpc(a.partyKey, "tools/call", { name, arguments: args }));
  expect(response.status).toBe(200);
  const body = await rpcBody(response);
  expect(body.error).toBeUndefined();
  return body.result;
}
const write = (kind: Kind, command: Command | "create", args: Record<string, unknown>) => call(toolName(kind, command), { requestKey: randomUUID(), ...args });
async function read(kind: Kind, id: string) {
  const response = await adapters[kind].item.GET(readRequest(`/${kind}s/${id}`, a.partyKey), readParams(id));
  expect(response.status).toBe(200);
  return (await response.json()).data;
}
function session(f: Fixture) {
  auth.session.mockResolvedValue({ user: { id: f.ctx.userId }, session: { activeOrganizationId: f.ctx.organizationId } });
}
function appCreate(kind: Kind, body: ReturnType<typeof input>) {
  const { locations, ...parent } = body;
  // Real forms carry empty text; the actions normalize it to null before the writer.
  return kind === "supplier"
    ? createSupplierWithLocationsFn({ supplier: { ...parent, address: "", location: "", contactName: "", contactEmail: "", contactPhone: "" }, locations })
    : createCustomerWithLocationsFn({ customer: { ...parent, address: "", contactEmail: "", contactPhone: "" },
      locations: locations.map(location => ({ ...location, address: location.siteDescription ?? "", defaultSoilTemperatureC: location.defaultSoilTemperatureC ?? null })) });
}
function appMutate(kind: Kind, command: Command, id: string, version: number, fields: { name?: string; sourceRegion?: string | null; cropType?: string | null } = {}) {
  if (kind === "supplier") {
    const args = { supplierId: id, expectedVersion: version };
    return command === "patch" ? updateSupplierFn({ ...args, ...fields, address: null, location: null, contactName: null, contactEmail: null, contactPhone: null }) : { delete: deleteSupplierFn, archive: archiveSupplierFn, restore: restoreSupplierFn }[command](args);
  }
  const args = { customerId: id, expectedVersion: version };
  return command === "patch" ? updateCustomerFn({ ...args, ...fields, address: null, contactEmail: null, contactPhone: null }) : { delete: deleteCustomerFn, archive: archiveCustomerFn, restore: restoreCustomerFn }[command](args);
}
async function stored(kind: Kind, id: string) {
  const table = kind === "supplier" ? suppliers : customers;
  const children = kind === "supplier" ? supplierLocations : customerLocations;
  const foreignKey = kind === "supplier" ? supplierLocations.supplierId : customerLocations.customerId;
  const pairs = kind === "supplier" ? supplierLocationFacilityDistances : customerLocationFacilityDistances;
  const rows = await db.select().from(table).where(eq(table.id, id));
  const locations = await db.select().from(children).where(eq(foreignKey, id)).orderBy(children.name);
  const distances = await db.select().from(pairs).where(eq(pairs.organizationId, a.ctx.organizationId));
  return { rows, locations, pairs: distances.filter(pair => locations.some(location => location.id === pair.locationId)) };
}
async function events(ids: string[], operation: string) {
  const rows = await db.select().from(activityEvents).where(eq(activityEvents.organizationId, a.ctx.organizationId)).orderBy(activityEvents.sequence);
  return rows.filter(event => ids.includes(event.entityId) && event.operationId === operation);
}
function comparableEvents(rows: Awaited<ReturnType<typeof events>>) {
  return rows.map(event => ({ action: event.action, entityType: event.entityType, operationId: event.operationId,
    versionBefore: event.versionBefore, versionAfter: event.versionAfter, fromStatus: event.fromStatus, toStatus: event.toStatus,
    changedFields: event.changedFields,
    // Separate fixture organizations generate different codes and parent IDs.
    changes: domainFields(event.changes),
  })).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
}

describe.each(["supplier", "customer"] as const)("%s three-way parity", kind => {
  it("creates, updates, archives, restores and deletes matching stored rows, locations, pairs and Activity", async () => {
    const third = await fixture(); fixtures.push(third);
    const name = "Parity party";
    const results: unknown[][] = [];
    for (const [surface, f] of [["form", fixtures[0]], ["rest", fixtures[1]], ["mcp", third]] as const) {
      a = f; session(f);
      const base = input(kind);
      const body = { ...base, name, locations: [base.locations[0], { ...base.locations[0], name: "Second", isDefault: false }, { ...base.locations[0], name: "Last" }] };
      let id: string;
      if (surface === "form") {
        const action = await appCreate(kind, body);
        expect(action.success).toBe(true);
        if (!action.success) throw new Error("App create refused");
        id = "customer" in action.data ? action.data.customer.id : action.data.id;
      } else if (surface === "rest") id = (await saved(kind, body)).data.id;
      else {
        const result = await write(kind, "create", body);
        expect(result.isError).toBeUndefined();
        id = result.structuredContent.data.id;
        expect(result.structuredContent.data).toEqual(await read(kind, id));
        expect(result.structuredContent.locations).toMatchObject([
          { version: 2, isDefault: false, facilityDistances: location().facilityDistances },
          { version: 1, isDefault: false, facilityDistances: location().facilityDistances },
          { version: 1, isDefault: true, facilityDistances: location().facilityDistances },
        ]);
      }
      const initial = await stored(kind, id);
      const ids = [id, ...initial.locations.map(row => row.id)];
      const observations: unknown[] = [];
      const observe = async (command: Command | "create") => {
        const state = await stored(kind, id);
        const activity = await events(ids, toolName(kind, command));
        expect(activity).toHaveLength(command === "create" ? 5 : command === "delete" ? 4 : 1);
        expect(activity.every(event => event.source === surface)).toBe(true);
        expect(activity.every(event => surface === "form" ? event.credentialId === null : event.credentialId !== null)).toBe(true);
        if (command === "create") {
          expect(activity.find(event => event.entityType === `${kind}_location` && event.versionBefore === 1)?.changedFields).toEqual(["isDefault"]);
        }
        if (command === "create" || command === "patch") {
          const parent = activity.find(event => event.entityType === kind)!;
          expect(parent.changedFields).toEqual([
            ...(command === "create" ? ["code"] : []), "name", kind === "supplier" ? "sourceRegion" : "cropType",
          ].sort());
        }
        const normalized = { ...state, pairs: state.pairs.map(pair => ({ ...pair, locationId: undefined })) };
        observations.push({ state: domainFields(normalized), activity: comparableEvents(activity) });
      };
      await observe("create");
      for (const [command, version] of [["patch", 1], ["archive", 2], ["restore", 3], ["delete", 4]] as const) {
        const fields = command === "patch" ? { name: "Changed party", ...(kind === "supplier" ? { sourceRegion: null } : { cropType: null }) } : {};
        if (surface === "form") expect((await appMutate(kind, command, id, version, fields)).success).toBe(true);
        else if (surface === "rest") expect((await mutate(kind, command, id, fields, `"${version}.2"`)).status).toBe(command === "delete" ? 204 : 200);
        else {
          const result = await write(kind, command, { ...fields, ...target(kind, id, version) });
          expect(result.isError).toBeUndefined();
          if (command !== "delete") expect(result.structuredContent.data).toEqual(await read(kind, id));
        }
        if (command !== "delete") {
          expect((await read(kind, id)).version).toBe(version + 1);
          expect((await stored(kind, id)).locations).toEqual(initial.locations);
        } else expect(await stored(kind, id)).toEqual({ rows: [], locations: [], pairs: [] });
        await observe(command);
      }
      results.push(observations);
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  }, TIMEOUT_MS);

  it.each(["create", ...commands] as const)("shares idempotency records in both directions for %s and replays stored outcomes", async command => {
    for (const first of ["rest", "mcp"] as const) {
      const row = command === "create" ? undefined : (await saved(kind)).data;
      let version = 1;
      if (command === "restore") { expect((await mutate(kind, "archive", row!.id)).status).toBe(200); version = 2; }
      const body = command === "create" ? input(kind) : command === "patch" ? { name: `Changed ${randomUUID()}` } : {};
      const key = randomUUID();
      const args = { ...body, ...(row ? target(kind, row.id, version) : {}), requestKey: key };
      const restCall = () => command === "create" ? post(kind, body, key) : mutate(kind, command, row!.id, body, `"${version}.2"`, key);
      let original: Record<string, unknown>;
      if (first === "rest") {
        const response = await restCall();
        expect(response.status).toBe(command === "create" ? 201 : command === "delete" ? 204 : 200);
        original = command === "delete" ? { deleted: { id: row!.id, code: row!.code } } : await response.json();
      } else {
        const result = await call(toolName(kind, command), args);
        expect(result.isError).toBeUndefined(); original = result.structuredContent;
      }
      if (command === "archive" || command === "restore") {
        expect((await mutate(kind, command === "archive" ? "restore" : "archive", row!.id, {}, `"${version + 1}.2"`)).status).toBe(200);
      }
      const before = await snapshot();
      const replay = await call(toolName(kind, command), args);
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
      expect(await call(toolName(kind, command), { ...args, ...(command === "create" || command === "patch" ? { name: "Other" } : { expectedVersion: version + 1 }) }))
        .toMatchObject({ isError: true, structuredContent: { code: "idempotency_key_reused" } });
      expect(await snapshot()).toEqual(before);
    }
  }, TIMEOUT_MS);
});

/** Refusals use the same target so blocker ids, codes and metadata must match exactly. */
async function refusal(kind: Kind, command: Command | "create", body: Record<string, unknown>, row: Row | undefined,
  code: string, pointer?: string, version = row?.version ?? 1) {
  const before = await snapshot();
  const action = command === "create" ? await appCreate(kind, body as ReturnType<typeof input>)
    : await appMutate(kind, command, row!.id, version, body);
  expect(action.success).toBe(false);
  if (action.success) throw new Error("App accepted refused input");
  const response = command === "create" ? await post(kind, body) : await mutate(kind, command, row!.id, body, `"${version}.2"`);
  const problem = await response.json();
  const result = await write(kind, command, { ...body, ...(row ? target(kind, row.id, version) : {}) });
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

describe.each(["supplier", "customer"] as const)("%s refusal parity and isolation", kind => {
  it("matches duplicate names across case and whitespace, including archived-name metadata", async () => {
    const body = input(kind);
    const row = (await saved(kind, body)).data;
    const other = (await saved(kind)).data;
    const duplicate = `  ${row.name.toUpperCase()}  `;
    await refusal(kind, "create", { ...body, name: duplicate }, undefined, "conflict", "/name");
    await refusal(kind, "patch", { name: duplicate }, other, "conflict", "/name");
    expect((await mutate(kind, "archive", row.id)).status).toBe(200);
    const problem = await refusal(kind, "create", { ...body, name: duplicate }, undefined, "conflict", "/name");
    expect(problem.errors[0].meta).toEqual({ [`${kind}Id`]: row.id, archived: true });
  }, TIMEOUT_MS);

  it("matches restore of active, stale versions, archived PATCH and repeated archive", async () => {
    const row = (await saved(kind)).data;
    await refusal(kind, "restore", {}, row, "conflict", `/${kind}Id`);
    expect((await mutate(kind, "patch", row.id, { name: "Changed" })).status).toBe(200);
    for (const command of commands) await refusal(kind, command, command === "patch" ? { name: "Refused" } : {}, row, "stale_version");
    expect((await mutate(kind, "archive", row.id, {}, '"2.2"')).status).toBe(200);
    const archived = await read(kind, row.id);
    for (const version of [1, archived.version]) await refusal(kind, "patch", { name: "Refused" }, archived, "not_found", `/${kind}Id`, version);
    await refusal(kind, "archive", {}, archived, "conflict", `/${kind}Id`);
    await refusal(kind, "archive", {}, archived, "stale_version", undefined, 2);
  }, TIMEOUT_MS);

  it("matches delete blockers and their metadata", async () => {
    if (kind === "supplier") {
      const [intake] = await db.select().from(feedstocks).where(eq(feedstocks.organizationId, a.ctx.organizationId));
      const problem = await refusal(kind, "delete", {}, await read(kind, intake.supplierId), "conflict", "/supplierId");
      expect(problem.errors[0].meta.feedstockCodes).toContain(intake.code);
    } else {
      const savedCustomer = await saved(kind);
      const order = await insertReadOrder(a, "PARTY-PARITY-ORDER", { customerId: savedCustomer.data.id, customerLocationId: savedCustomer.locations[0].id });
      const delivery = await insertReadDelivery(a, order.id, order.quantityKg);
      const problem = await refusal(kind, "delete", {}, savedCustomer.data, "conflict", "/customerId");
      expect(problem.errors[0].meta).toEqual({ deliveryCodes: [delivery.code] });
    }
  }, TIMEOUT_MS);

  it("hides each tool without its scope, including archive and restore for delete-only keys", async () => {
    const tools = (["create", ...commands] as const).map(command => toolName(kind, command));
    const row = (await saved(kind)).data;
    for (const scope of ["read", "write", "delete"] as const) {
      const key = await a.key([`${kind}s:${scope}`]);
      const allowed = scope === "read" ? [] : scope === "write" ? tools.filter(name => name !== `delete_${kind}`) : [`delete_${kind}`];
      const listing = await rpcBody(await MCP(rpc(key, "tools/list")));
      const names = listing.result.tools.map((tool: { name: string }) => tool.name);
      const before = await snapshot();
      for (const name of tools) {
        expect(names.includes(name)).toBe(allowed.includes(name));
        if (allowed.includes(name)) continue;
        const args = name === `create_${kind}` ? input(kind) : target(kind, row.id, row.version);
        const hidden = await rpcBody(await MCP(rpc(key, "tools/call", { name, arguments: { ...args, requestKey: randomUUID() } })));
        const unknown = await rpcBody(await MCP(rpc(key, "tools/call", { name: "unknown_tool", arguments: {} })));
        expect(hidden.error).toEqual(unknown.error);
        expect(hidden.result).toBeUndefined();
      }
      expect(await snapshot()).toEqual(before);
    }
  }, TIMEOUT_MS);

  it("answers not_found for foreign party ids and facility ids without writing in either organization", async () => {
    const foreignId = kind === "customer" ? b.customer.id : (await db.select().from(feedstocks).where(eq(feedstocks.organizationId, b.ctx.organizationId)))[0].supplierId;
    const before = await snapshot();
    const foreignBefore = await snapshot(b);
    const foreign = { id: foreignId, code: "", name: "", version: 1 };
    for (const command of commands) await refusal(kind, command, {}, foreign, "not_found", `/${kind}Id`);
    const body = { ...input(kind), locations: [{ ...location(), facilityDistances: [{ ...location().facilityDistances[0], facilityId: b.facility.id }] }] };
    await refusal(kind, "create", body, undefined, "not_found", "/locations/0/facilityDistances/0/facilityId");
    expect(await snapshot()).toEqual(before);
    expect(await snapshot(b)).toEqual(foreignBefore);
  }, TIMEOUT_MS);

  it.each(["create", ...commands] as const)("previews %s without saving rows, locations, pairs, Activity or idempotency", async command => {
    const row = command === "create" ? undefined : (await saved(kind)).data;
    let version = 1;
    if (command === "restore") { expect((await mutate(kind, "archive", row!.id)).status).toBe(200); version = 2; }
    const body = command === "create" ? input(kind) : command === "patch" ? { name: "Preview" } : {};
    const before = await snapshot();
    const result = await call(toolName(kind, command), { ...body, ...(row ? target(kind, row.id, version) : {}), dryRun: true });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.data.version).toBe(command === "create" ? 1 : command === "delete" ? version : version + 1);
    const response = command === "create" ? await post(kind, body, randomUUID(), "?dryRun=true")
      : await mutate(kind, command, row!.id, body, `"${version}.2"`, undefined, "?dryRun=true");
    expect(response.status).toBe(200);
    expect(domainFields(result.structuredContent)).toEqual(domainFields(await response.json()));
    expect(await snapshot()).toEqual(before);
  }, TIMEOUT_MS);
});
