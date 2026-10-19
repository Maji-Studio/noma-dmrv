import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, notExists } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, apiIdempotencyRecords, suppliers, customers, supplierLocations, customerLocations, supplierLocationFacilityDistances, customerLocationFacilityDistances, certifierProjects, certifierStorageLocations, feedstocks, orders, deliveries } from "@/db/schema";
import { POST as MCP } from "@/app/api/mcp/route";
import { rpc, rpcBody } from "./helpers/mcp";
import { createApiKey } from "@/data-access/api-keys";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { buildCreateStorageLocationRequest } from "@/lib/isometric/storage-locations";
import { jsonPointer } from "@/lib/api/problem";
import * as supplierCollection from "@/app/api/v1/suppliers/[idOrCode]/locations/route";
import * as supplierItem from "@/app/api/v1/suppliers/[idOrCode]/locations/[locationId]/route";
import * as customerCollection from "@/app/api/v1/customers/[idOrCode]/locations/route";
import * as customerItem from "@/app/api/v1/customers/[idOrCode]/locations/[locationId]/route";
import { POST as createSupplier } from "@/app/api/v1/suppliers/route";
import { POST as createCustomer } from "@/app/api/v1/customers/route";
import { POST as archiveSupplier } from "@/app/api/v1/suppliers/[idOrCode]/archive/route";
import { POST as archiveCustomer } from "@/app/api/v1/customers/[idOrCode]/archive/route";
import { POST as archiveLocation } from "@/app/api/v1/customers/[idOrCode]/locations/[locationId]/archive/route";
import { POST as restoreLocation } from "@/app/api/v1/customers/[idOrCode]/locations/[locationId]/restore/route";
import { createSupplierLocationFn, updateSupplierLocationFn, deleteSupplierLocationFn } from "@/fn/suppliers";
import { createCustomerLocationFn, updateCustomerLocationFn, deleteCustomerLocationFn, archiveCustomerLocationFn, restoreCustomerLocationFn } from "@/fn/customers";
import * as supplierSchemas from "@/schemas/suppliers";
import * as customerSchemas from "@/schemas/customers";
import * as supplierOperations from "@/lib/operations/supplier-locations";
import * as customerOperations from "@/lib/operations/customer-locations";
import { runOperation } from "@/lib/operations/runner";
import { createApiOrderReadFixture, insertReadOrder, insertReadDelivery, removeApiOrderReadFixture, readParams } from "./helpers/api-order-read-fixture";

const auth = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/auth/providers/better-auth-server", async original => ({
  ...await original<typeof import("@/lib/auth/providers/better-auth-server")>(), getBetterAuthSession: auth.session,
}));
const TIMEOUT_MS = 60_000;
const INITIAL_VERSION = 1;
type Kind = "supplier" | "customer";
type Command = "add" | "update" | "delete" | "archive" | "restore";
const commands = (kind: Kind): Command[] => kind === "supplier" ? ["add", "update", "delete"] : ["add", "update", "delete", "archive", "restore"];
const adapters = {
  supplier: { collection: supplierCollection, item: supplierItem, create: createSupplier, archive: archiveSupplier },
  customer: { collection: customerCollection, item: customerItem, create: createCustomer, archive: archiveCustomer },
};
type Target = { parentId: string; locationId: string; version: number };
type Fixture = Awaited<ReturnType<typeof fixture>>;
let a: Fixture;
let b: Fixture;
let fixtures: Fixture[];
async function fixture() {
  const f = await createApiOrderReadFixture();
  const key = async (scopes: ApiScope[]) => (await createApiKey(f.ctx, { name: "Location parity fixture", scopes, expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key;
  return { ...f, key, partyKey: await key(["suppliers:read", "suppliers:write", "suppliers:delete", "customers:read", "customers:write", "customers:delete"]) };
}
beforeEach(async () => {
  fixtures = [];
  a = await fixture(); fixtures.push(a);
  b = await fixture(); fixtures.push(b);
  auth.session.mockResolvedValue({ user: { id: a.ctx.userId }, session: { activeOrganizationId: a.ctx.organizationId } });
}, TIMEOUT_MS);
afterEach(async () => {
  for (const f of fixtures) {
    await db.delete(certifierStorageLocations).where(eq(certifierStorageLocations.organizationId, f.ctx.organizationId));
    await db.delete(certifierProjects).where(eq(certifierProjects.organizationId, f.ctx.organizationId));
    await db.delete(supplierLocationFacilityDistances).where(eq(supplierLocationFacilityDistances.organizationId, f.ctx.organizationId));
    await db.delete(customerLocationFacilityDistances).where(eq(customerLocationFacilityDistances.organizationId, f.ctx.organizationId));
    await db.delete(supplierLocations).where(eq(supplierLocations.organizationId, f.ctx.organizationId));
    await db.delete(suppliers).where(and(eq(suppliers.organizationId, f.ctx.organizationId), notExists(
      db.select({ id: feedstocks.id }).from(feedstocks).where(eq(feedstocks.supplierId, suppliers.id)),
    )));
    await removeApiOrderReadFixture(f);
  }
}, TIMEOUT_MS);
function request(path: string, method: string, body?: unknown, headers: Record<string, string> = {}, key = a.partyKey) {
  return new Request(`http://localhost:3100/api/v1${path}`, { method, headers: { authorization: `Bearer ${key}`,
    ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers,
  }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const site = { name: "Primary", country: "Tanzania", gpsLatitude: -8, gpsLongitude: 34, isDefault: true };
async function parent(kind: Kind, f = a, single = false): Promise<Target> {
  const response = await adapters[kind].create(request(`/${kind}s`, "POST", { name: randomUUID(), locations: [site,
    ...(single ? [] : [{ ...site, name: "Secondary", isDefault: false }])],
  }, { "idempotency-key": randomUUID() }, f.partyKey));
  expect(response.status).toBe(201);
  const body = await response.json();
  return { parentId: body.data.id, locationId: body.locations[0].id, version: body.locations[0].version };
}
const name = (kind: Kind, command: Command) => `${command}_${kind}_location`;
const args = (kind: Kind, command: Command, target: Target, fields: Record<string, unknown>) => ({
  [`${kind}Id`]: target.parentId, ...fields,
  ...(command === "add" ? {} : { locationId: target.locationId, expectedVersion: target.version }),
});
function rest(kind: Kind, command: Command, t: Target, fields: Record<string, unknown> = {}, key?: string, dryRun = false, credential = a.partyKey) {
  const query = dryRun ? "?dryRun=true" : "";
  const headers = { ...(key ? { "idempotency-key": key } : {}), ...(command === "add" ? {} : { "if-match": `"${t.version}.1"` }) };
  if (command === "add") return adapters[kind].collection.POST(request(`/${kind}s/${t.parentId}/locations${query}`, "POST", fields, headers, credential), readParams(t.parentId));
  const handler = command === "update" ? adapters[kind].item.PATCH : command === "delete" ? adapters[kind].item.DELETE : command === "archive" ? archiveLocation : restoreLocation;
  const suffix = command === "archive" || command === "restore" ? `/${command}` : "";
  return handler(request(`/${kind}s/${t.parentId}/locations/${t.locationId}${suffix}${query}`, command === "update" ? "PATCH" : command === "delete" ? "DELETE" : "POST", fields, headers, credential),
    { params: Promise.resolve({ idOrCode: t.parentId, locationId: t.locationId }) });
}
async function mcp(kind: Kind, command: Command, t: Target, fields: Record<string, unknown> = {}, controls: Record<string, unknown> = { requestKey: randomUUID() }, credential = a.partyKey) {
  const response = await MCP(rpc(credential, "tools/call", { name: name(kind, command), arguments: { ...args(kind, command, t, fields), ...controls } }));
  expect(response.status).toBe(200);
  const body = await rpcBody(response);
  expect(body.error).toBeUndefined();
  return body.result;
}
function app(kind: Kind, command: Command, target: Target, fields: Record<string, unknown>) {
  const { siteDescription, ...rest } = fields;
  const input = { ...args(kind, command, target, rest), ...(siteDescription === undefined ? {} : { address: siteDescription }) };
  if (kind === "supplier") {
    if (command === "add") return createSupplierLocationFn(supplierSchemas.createSupplierLocationSchema.parse(input));
    if (command === "update") return updateSupplierLocationFn(supplierSchemas.updateSupplierLocationSchema.parse(input));
    return deleteSupplierLocationFn(supplierSchemas.deleteSupplierLocationSchema.parse(input));
  }
  if (command === "add") return createCustomerLocationFn(customerSchemas.createCustomerLocationSchema.parse(input));
  if (command === "update") return updateCustomerLocationFn(customerSchemas.updateCustomerLocationSchema.parse(input));
  if (command === "delete") return deleteCustomerLocationFn(customerSchemas.deleteCustomerLocationSchema.parse(input));
  return (command === "archive" ? archiveCustomerLocationFn : restoreCustomerLocationFn)(input as { customerId: string; locationId: string; expectedVersion: number });
}
// Actions have no preview control; preview their shared operations through the transport runner.
function appPreview(kind: Kind, command: Command, target: Target, fields: Record<string, unknown>) {
  const { siteDescription, ...rest } = fields;
  const input = { ...args(kind, command, target, rest), ...(siteDescription === undefined ? {} : { address: siteDescription }) };
  const options = { dryRun: true };
  if (kind === "supplier") {
    if (command === "add") return runOperation(supplierOperations.addSupplierLocation, a.ctx, input, options);
    if (command === "update") return runOperation(supplierOperations.updateSupplierLocation, a.ctx, input, options);
    return runOperation(supplierOperations.deleteSupplierLocation, a.ctx, input, options);
  }
  if (command === "add") return runOperation(customerOperations.addCustomerLocation, a.ctx, input, options);
  if (command === "update") return runOperation(customerOperations.updateCustomerLocation, a.ctx, input, options);
  if (command === "delete") return runOperation(customerOperations.deleteCustomerLocation, a.ctx, input, options);
  return runOperation(command === "archive" ? customerOperations.archiveCustomerLocation : customerOperations.restoreCustomerLocation, a.ctx, input, options);
}
async function read(kind: Kind, target: Target) {
  const response = await adapters[kind].item.GET(request(`/${kind}s/${target.parentId}/locations/${target.locationId}`, "GET"),
    { params: Promise.resolve({ idOrCode: target.parentId, locationId: target.locationId }) });
  expect(response.status).toBe(200);
  return (await response.json()).data;
}
async function prepared(kind: Kind, command: Command) {
  const t = await parent(kind);
  if (command === "restore") {
    expect((await rest(kind, "archive", t)).status).toBe(200);
    t.version++;
  }
  return t;
}
const fieldsFor = (kind: Kind, command: Command): Record<string, unknown> => command === "add" ? { ...site, name: "Added", isDefault: false,
  ...(kind === "customer" ? { siteDescription: "North field", defaultSoilTemperatureC: 0 } : {}),
  facilityDistances: [{ facilityId: a.facility.id, distanceKm: 12.5, distanceSource: "manual" }],
} : command === "update" ? { city: "Mbeya", facilityDistances: [{ facilityId: a.facility.id, distanceKm: 12.5, distanceSource: "manual" }] } : {};
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
    db.select().from(orders).where(eq(orders.organizationId, org)).orderBy(orders.id),
    db.select().from(deliveries).where(eq(deliveries.organizationId, org)).orderBy(deliveries.id),
    db.select().from(certifierStorageLocations).where(eq(certifierStorageLocations.organizationId, org)).orderBy(certifierStorageLocations.id),
  ]);
}
function domainFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(domainFields);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["id", "supplierId", "customerId", "locationId", "createdAt", "updatedAt"].includes(key))
    .map(([key, field]) => [key, key === "archivedAt" ? field !== null : domainFields(field)]));
  return value;
}
async function state(kind: Kind, t: Target, operation: string, source: string) {
  const table = kind === "supplier" ? supplierLocations : customerLocations;
  const parent = kind === "supplier" ? suppliers : customers;
  const foreignKey = kind === "supplier" ? supplierLocations.supplierId : customerLocations.customerId;
  const pairs = kind === "supplier" ? supplierLocationFacilityDistances : customerLocationFacilityDistances;
  const locations = await db.select().from(table).where(eq(foreignKey, t.parentId)).orderBy(table.name);
  const distances = await db.select().from(pairs).where(eq(pairs.organizationId, a.ctx.organizationId));
  const events = (await db.select().from(activityEvents).where(eq(activityEvents.organizationId, a.ctx.organizationId)).orderBy(activityEvents.sequence))
    .filter(event => event.operationId === operation && (event.entityId === t.locationId || locations.some(row => row.id === event.entityId)));
  expect(events.length).toBeGreaterThan(0);
  expect(events.every(event => event.source === source)).toBe(true);
  const [party] = await db.select().from(parent).where(eq(parent.id, t.parentId));
  expect(party.version).toBe(INITIAL_VERSION);
  return domainFields({ locations, distances: distances.filter(pair => locations.some(row => row.id === pair.locationId)).map(pair => ({ ...pair, locationId: undefined })),
    events: events.map(event => ({ action: event.action, entityType: event.entityType, versionBefore: event.versionBefore, versionAfter: event.versionAfter,
      fromStatus: event.fromStatus, toStatus: event.toStatus, changedFields: event.changedFields, changes: event.changes })),
  });
}
async function refusal(kind: Kind, command: Command, target: Target, code: string, pointer?: string, fields = fieldsFor(kind, command)) {
  const before = await snapshot();
  const action = await app(kind, command, target, fields);
  expect(action.success).toBe(false);
  if (action.success) throw new Error("App accepted refused location command");
  const response = await rest(kind, command, target, fields, randomUUID());
  expect(response.status).toBe(code === "not_found" ? 404 : code === "stale_version" ? 412 : 409);
  const problem = await response.json();
  const result = await mcp(kind, command, target, fields);
  expect(result.isError).toBe(true);
  expect(action.code).toBe(code);
  expect(problem.code).toBe(code);
  expect(result.structuredContent.code).toBe(code);
  const issues = (action.issues ?? []).map(issue => ({ code: issue.code, pointer: jsonPointer(issue.path), meta: issue.meta }));
  const normalize = (items: { code: string; pointer?: string; meta?: unknown }[]) => items.map(({ code, pointer, meta }) => ({ code, pointer, meta }));
  expect(normalize(problem.errors)).toEqual(issues);
  expect(normalize(result.structuredContent.issues)).toEqual(issues);
  if (pointer) expect(issues).toContainEqual(expect.objectContaining({ pointer }));
  if (problem.current) expect(result.structuredContent.current).toEqual(problem.current);
  expect(await snapshot()).toEqual(before);
  return problem;
}

describe.each(["supplier", "customer"] as const)("%s location three-way parity", kind => {
  it.each(commands(kind))("%s produces matching stored facts, pairs and Activity", async command => {
    const results: unknown[] = [];
    for (const surface of ["form", "rest", "mcp"] as const) {
      let warnings: unknown = [];
      const t = await prepared(kind, command);
      const fields = fieldsFor(kind, command);
      const before = await read(kind, t);
      if (surface === "form") {
        const result = await app(kind, command, t, fields);
        expect(result.success).toBe(true);
        if (!result.success) throw new Error("App location command refused");
        if (result.data && typeof result.data === "object" && "warnings" in result.data) warnings = result.data.warnings;
        if (command === "add") t.locationId = (result.data as { id: string }).id;
        if (command !== "delete") expect(await read(kind, t)).toMatchObject({ id: t.locationId, version: command === "add" ? 1 : t.version + 1 });
      } else if (surface === "rest") {
        const response = await rest(kind, command, t, fields, randomUUID());
        expect(response.status).toBe(command === "add" ? 201 : command === "delete" ? 204 : 200);
        if (command !== "delete") {
          const body = await response.json();
          warnings = body.warnings ?? [];
          t.locationId = body.data.id;
          expect(body.data).toEqual(await read(kind, t));
        }
      } else {
        const result = await mcp(kind, command, t, fields);
        expect(result.isError).toBeUndefined();
        warnings = result.structuredContent.warnings ?? [];
        t.locationId = result.structuredContent.data.id;
        expect(result.structuredContent.data).toEqual(command === "delete" ? before : await read(kind, t));
      }
      // The app delete action returns void and REST returns 204; warnings on
      // their shared delete outcome are compared through previews below.
      results.push({ state: await state(kind, t, name(kind, command), surface), warnings: command === "delete" ? [] : warnings });
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  }, TIMEOUT_MS);

  it.each(commands(kind))("previews %s without saving rows, pairs, Activity or replay records", async command => {
    const t = await prepared(kind, command);
    const fields = fieldsFor(kind, command);
    const before = await snapshot();
    const { data: native } = await appPreview(kind, command, t, fields);
    const response = await rest(kind, command, t, fields, randomUUID(), true);
    expect(response.status).toBe(200);
    const body = await response.json();
    const result = await mcp(kind, command, t, fields, { dryRun: true });
    expect(result.isError).toBeUndefined();
    expect(domainFields(result.structuredContent)).toEqual(domainFields(body));
    expect(native).toMatchObject({ name: body.data.name, country: body.data.country, city: body.data.city,
      gpsLatitude: body.data.gpsLatitude, gpsLongitude: body.data.gpsLongitude, isDefault: body.data.isDefault, version: body.data.version });
    expect("archivedAt" in native && native.archivedAt !== null).toBe(body.data.archivedAt !== null);
    expect(native.warnings).toEqual(body.warnings ?? []);
    expect(await snapshot()).toEqual(before);
  }, TIMEOUT_MS);

  it.each(commands(kind))("shares %s replay records from REST to MCP and MCP to REST", async command => {
    for (const first of ["rest", "mcp"] as const) {
      const t = await prepared(kind, command);
      const fields = fieldsFor(kind, command);
      const key = randomUUID();
      const beforeDelete = command === "delete" ? await (await rest(kind, command, t, {}, undefined, true)).json() : undefined;
      let original: Record<string, unknown>;
      if (first === "rest") {
        const response = await rest(kind, command, t, fields, key);
        expect(response.status).toBe(command === "add" ? 201 : command === "delete" ? 204 : 200);
        original = command === "delete" ? beforeDelete : await response.json();
      } else {
        const result = await mcp(kind, command, t, fields, { requestKey: key });
        expect(result.isError).toBeUndefined();
        original = result.structuredContent;
      }
      // Make live state differ so the replay must precede current-state checks.
      if (command === "update") expect((await rest(kind, "delete", { ...t, version: t.version + 1 })).status).toBe(204);
      if (command === "archive" || command === "restore") expect((await rest(kind, command === "archive" ? "restore" : "archive", { ...t, version: t.version + 1 })).status).toBe(200);
      const before = await snapshot();
      const replay = await mcp(kind, command, t, fields, { requestKey: key });
      expect(replay.isError).toBeUndefined();
      expect(replay.structuredContent).toEqual(original);
      expect(replay.content[0].text).toMatch(/^Replayed:/);
      const restReplay = await rest(kind, command, t, fields, key);
      expect(restReplay.headers.get("idempotent-replayed")).toBe("true");
      if (command === "delete") expect(restReplay.status).toBe(204);
      else expect(await restReplay.json()).toEqual(original);
      const records = await db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, a.ctx.organizationId));
      expect(records.filter(record => record.idempotencyKey === key)).toHaveLength(1);
      const reused = await mcp(kind, command, t, command === "add" || command === "update" ? { ...fields, city: "Other" } : fields,
        { requestKey: key, ...(command === "add" || command === "update" ? {} : { expectedVersion: t.version + 1 }) });
      expect(reused).toMatchObject({ isError: true, structuredContent: { code: "idempotency_key_reused" } });
      expect(await snapshot()).toEqual(before);
    }
  }, TIMEOUT_MS);

  it("hides every location command without its matching write or delete scope", async () => {
    const t = await parent(kind);
    const before = await snapshot();
    for (const scope of ["read", "write", "delete"] as const) {
      const key = await a.key([`${kind}s:${scope}`]);
      const listing = await rpcBody(await MCP(rpc(key, "tools/list")));
      const names = listing.result.tools.map((tool: { name: string }) => tool.name);
      for (const command of commands(kind)) {
        const allowed = command === "delete" ? scope === "delete" : scope === "write";
        expect(names.includes(name(kind, command))).toBe(allowed);
        if (allowed) continue;
        const hidden = await rpcBody(await MCP(rpc(key, "tools/call", { name: name(kind, command), arguments: { ...args(kind, command, t, fieldsFor(kind, command)), requestKey: randomUUID() } })));
        const unknown = await rpcBody(await MCP(rpc(key, "tools/call", { name: "unknown_tool", arguments: {} })));
        expect(hidden.error).toEqual(unknown.error);
        expect(hidden.result).toBeUndefined();
      }
    }
    expect(await snapshot()).toEqual(before);
  }, TIMEOUT_MS);

  it("matches wrong-parent and foreign-org refusals before stale versions", async () => {
    const own = await parent(kind);
    const other = await parent(kind);
    const foreign = await parent(kind, b);
    const foreignBefore = await snapshot(b);
    await refusal(kind, "add", { ...own, parentId: foreign.parentId }, "not_found", `/${kind}Id`);
    for (const command of commands(kind).filter(command => command !== "add")) for (const version of [1, 99]) {
      for (const t of [{ ...other, parentId: own.parentId }, foreign, { ...own, parentId: foreign.parentId }]) {
        await refusal(kind, command, { ...t, version }, "not_found", "/locationId");
      }
    }
    expect(await snapshot(b)).toEqual(foreignBefore);
  }, TIMEOUT_MS);

  it("matches archived-parent and stale-version refusals for every applicable command", async () => {
    const t = await parent(kind);
    for (const command of commands(kind).filter(command => command !== "add")) await refusal(kind, command, { ...t, version: 99 }, "stale_version");
    expect((await adapters[kind].archive(request(`/${kind}s/${t.parentId}/archive`, "POST", {}, { "if-match": '"1.2"' }), readParams(t.parentId))).status).toBe(200);
    for (const command of commands(kind)) for (const version of [1, 99]) {
      await refusal(kind, command, { ...t, version }, "not_found", `/${kind}Id`);
    }
  }, TIMEOUT_MS);

  it.each(["add", "update"] as const)("matches a foreign facility refusal and pointer on %s", async command => {
    const t = await parent(kind);
    const foreignBefore = await snapshot(b);
    await refusal(kind, command, t, "not_found", "/facilityDistances/0/facilityId", {
      ...fieldsFor(kind, command), facilityDistances: [{ facilityId: b.facility.id, distanceKm: 12.5, distanceSource: "manual" }],
    });
    expect(await snapshot(b)).toEqual(foreignBefore);
  }, TIMEOUT_MS);
});

describe("customer destination refusals", () => {
  it("matches archived PATCH, repeated archive and last-active archive refusals", async () => {
    const t = await parent("customer");
    expect((await rest("customer", "archive", t)).status).toBe(200);
    for (const version of [1, 2, 99]) await refusal("customer", "update", { ...t, version }, "not_found", "/locationId");
    await refusal("customer", "archive", t, "stale_version");
    await refusal("customer", "archive", { ...t, version: 2 }, "conflict", "/locationId");
    const only = await parent("customer", a, true);
    await refusal("customer", "archive", only, "conflict", "/locationId");
  }, TIMEOUT_MS);

  it("matches in-use delete metadata and preserves orders, deliveries and storage registration on archive", async () => {
    const t = await parent("customer");
    const order = await insertReadOrder(a, "LOCATION-PARITY-ORDER", { customerId: t.parentId, customerLocationId: t.locationId });
    const delivery = await insertReadDelivery(a, order.id, order.quantityKg);
    const problem = await refusal("customer", "delete", t, "conflict", "/locationId");
    expect(problem.errors[0].meta).toEqual({ orderCodes: [order.code] });
    const [project] = await db.insert(certifierProjects).values({ organizationId: a.ctx.organizationId, facilityId: a.facility.id,
      provider: "isometric", externalProjectId: `prj-${randomUUID()}`, externalFacilityId: `fcl-${randomUUID()}` }).returning();
    const [mapping] = await db.insert(certifierStorageLocations).values({ organizationId: a.ctx.organizationId, customerLocationId: t.locationId,
      certifierProjectId: project.id, externalProjectId: project.externalProjectId, externalStorageLocationId: `slc-${randomUUID()}`,
      supplierReference: t.locationId, submittedPayload: buildCreateStorageLocationRequest({ externalProjectId: project.externalProjectId, name: site.name, latitude: site.gpsLatitude, longitude: site.gpsLongitude, supplierReferenceId: t.locationId }), payloadHash: "test" }).returning();
    const result = await mcp("customer", "archive", t);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.warnings).toEqual([expect.stringContaining("default location")]);
    expect(await db.select().from(orders).where(eq(orders.id, order.id))).toEqual([order]);
    expect(await db.select().from(deliveries).where(eq(deliveries.id, delivery.id))).toEqual([delivery]);
    expect(await db.select().from(certifierStorageLocations).where(eq(certifierStorageLocations.id, mapping.id))).toEqual([mapping]);
    const listing = await rpcBody(await MCP(rpc(a.partyKey, "tools/call", { name: "find_customer_locations", arguments: { idOrCode: t.parentId, archived: true } })));
    expect(listing.result.structuredContent.data).toContainEqual(expect.objectContaining({ id: t.locationId }));
    await refusal("customer", "delete", { ...t, version: 2 }, "conflict", "/locationId");
  }, TIMEOUT_MS);

  it("matches a storage-site-only delete refusal", async () => {
    const t = await parent("customer");
    const [project] = await db.insert(certifierProjects).values({ organizationId: a.ctx.organizationId, facilityId: a.facility.id,
      provider: "isometric", externalProjectId: `prj-${randomUUID()}`, externalFacilityId: `fcl-${randomUUID()}` }).returning();
    await db.insert(certifierStorageLocations).values({ organizationId: a.ctx.organizationId, customerLocationId: t.locationId,
      certifierProjectId: project.id, externalProjectId: project.externalProjectId, externalStorageLocationId: `slc-${randomUUID()}`,
      supplierReference: t.locationId, submittedPayload: buildCreateStorageLocationRequest({ externalProjectId: project.externalProjectId, name: site.name, latitude: site.gpsLatitude, longitude: site.gpsLongitude, supplierReferenceId: t.locationId }), payloadHash: "test" });
    await refusal("customer", "delete", t, "conflict", "/locationId");
  }, TIMEOUT_MS);
});
