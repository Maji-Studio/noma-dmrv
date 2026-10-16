import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, notExists } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, apiIdempotencyRecords, suppliers, customers, supplierLocations, customerLocations, supplierLocationFacilityDistances, customerLocationFacilityDistances, certifierProjects, certifierStorageLocations, feedstocks } from "@/db/schema";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { buildCreateStorageLocationRequest } from "@/lib/isometric/storage-locations";
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import * as supplierCollection from "@/app/api/v1/suppliers/route";
import * as supplierItem from "@/app/api/v1/suppliers/[idOrCode]/route";
import { POST as supplierArchive } from "@/app/api/v1/suppliers/[idOrCode]/archive/route";
import { POST as supplierRestore } from "@/app/api/v1/suppliers/[idOrCode]/restore/route";
import * as customerCollection from "@/app/api/v1/customers/route";
import * as customerItem from "@/app/api/v1/customers/[idOrCode]/route";
import { GET as customerLocationList } from "@/app/api/v1/customers/[idOrCode]/locations/route";
import { POST as customerArchive } from "@/app/api/v1/customers/[idOrCode]/archive/route";
import { POST as customerRestore } from "@/app/api/v1/customers/[idOrCode]/restore/route";
import { supplierRepresentationSchema } from "@/lib/representations/suppliers";
import { customerRepresentationSchema } from "@/lib/representations/customers";
import { createSupplierWithLocationsFn, updateSupplierFn } from "@/fn/suppliers";
import { createCustomerWithLocationsFn, updateCustomerFn } from "@/fn/customers";
import { createApiOrderReadFixture, insertReadOrder, removeApiOrderReadFixture, readParams, readRequest } from "./helpers/api-order-read-fixture";

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
async function fixture() {
  const f = await createApiOrderReadFixture();
  const key = async (scopes: ApiScope[]) => (await createApiKey(f.ctx, { name: "Party route fixture", scopes, expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key;
  return { ...f, partyKey: await key(["suppliers:read", "suppliers:write", "suppliers:delete", "customers:read", "customers:write", "customers:delete"]),
    readKey: await key(["suppliers:read", "customers:read"]), writeKey: await key(["suppliers:write", "customers:write"]), deleteKey: await key(["suppliers:delete", "customers:delete"]) };
}
beforeEach(async () => {
  a = await fixture(); b = await fixture();
  auth.session.mockResolvedValue({ user: { id: a.ctx.userId }, session: { activeOrganizationId: a.ctx.organizationId } });
}, TIMEOUT_MS);
afterEach(async () => {
  for (const f of [a, b]) if (f) {
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
const input = (kind: Kind) => ({ name: `New ${kind}`, ...(kind === "supplier" ? { sourceRegion: "Mbeya" } : { cropType: "Coffee" }), locations: [location()] });
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
async function problem(response: Response, status: number, code: string, pointer?: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/problem+json");
  const body = await response.json();
  expect(body.code).toBe(code);
  if (pointer) expect(body.errors).toContainEqual(expect.objectContaining({ pointer }));
  return body;
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
    .filter(([key]) => !["id", "supplierId", "customerId", "createdAt", "updatedAt"].includes(key))
    .map(([key, field]) => [key, key === "archivedAt" ? field !== null : domainFields(field)]));
  return value;
}

describe.each(["supplier", "customer"] as const)("%s REST writes", kind => {
  it("creates a revision 2 representation with ETag, Location and saved location ids and versions", async () => {
    const response = await post(kind);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(adapters[kind].schema.parse(body.data)).toEqual(body.data);
    expect(body.data).toMatchObject({ version: 1, archivedAt: null });
    expect(body.locations).toMatchObject([{ id: expect.any(String), version: 1, isDefault: true, facilityDistances: location().facilityDistances }]);
    expect(response.headers.get("etag")).toBe(INITIAL_ETAG);
    expect(response.headers.get("location")).toBe(`/api/v1/${kind}s/${body.data.id}`);
    const read = await adapters[kind].item.GET(readRequest(`/${kind}s/${body.data.id}`, a.partyKey), readParams(body.data.id));
    expect(await read.json()).toEqual({ data: body.data });
    expect(read.headers.get("etag")).toBe(INITIAL_ETAG);
  }, TIMEOUT_MS);

  it("updates by UUID with a strong precondition and returns the current representation on stale versions", async () => {
    const { data } = await (await post(kind)).json();
    const patch = (tag?: string) => adapters[kind].item.PATCH(request(kind, "PATCH", `/${data.id.toUpperCase()}`, { name: "Changed party" }, tag ? { "if-match": tag } : {}), readParams(data.id.toUpperCase()));
    expect((await patch()).status).toBe(428);
    const changed = await patch(INITIAL_ETAG);
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).toBe('"2.2"');
    const saved = await changed.json();
    expect(saved.data).toMatchObject({ id: data.id, version: 2, name: "Changed party" });
    
    const stale = await patch(INITIAL_ETAG);
    expect(stale.status).toBe(412);
    expect(await stale.json()).toMatchObject({ code: "stale_version", current: saved.data });
  });

  it("keeps app contact details out of PATCH, stale current and replayed outcomes", async () => {
    const contacts = { contactEmail: "private@example.test", contactPhone: "+255123456789", address: "Private street" };
    const supplierDetails = { contactName: "Private contact", location: "Private region" };
    let id: string;
    if (kind === "supplier") {
      const created = await createSupplierWithLocationsFn({ supplier: { name: "App supplier", ...contacts, ...supplierDetails }, locations: [location()] });
      expect(created.success).toBe(true);
      if (!created.success) throw new Error("App supplier create failed");
      expect(created.data).toMatchObject({ ...contacts, ...supplierDetails });
      id = created.data.id;
    } else {
      const created = await createCustomerWithLocationsFn({ customer: { name: "App customer", ...contacts }, locations: [location()] });
      expect(created.success).toBe(true);
      if (!created.success) throw new Error("App customer create failed");
      expect(created.data.customer).toMatchObject(contacts);
      id = created.data.customer.id;
    }
    const expectPublic = (body: unknown) => {
      const text = JSON.stringify(body);
      for (const [field, value] of Object.entries({ ...contacts, ...supplierDetails })) {
        expect(text).not.toContain(`"${field}"`);
        expect(text).not.toContain(value);
      }
    };
    const key = randomUUID();
    const body = { name: "Renamed app party" };
    const patch = await mutate(kind, "patch", id, body, INITIAL_ETAG, key);
    expect(patch.status).toBe(200);
    const text = await patch.text();
    const changed = JSON.parse(text);
    expect(changed.data).toMatchObject({ id, name: body.name, version: 2 });
    expect(adapters[kind].schema.parse(changed.data)).toEqual(changed.data);
    expectPublic(changed);
    const stale = await problem(await mutate(kind, "patch", id, body), 412, "stale_version");
    expect(stale.current).toEqual(changed.data);
    expectPublic(stale);
    const replay = await mutate(kind, "patch", id, body, INITIAL_ETAG, key);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    const replayText = await replay.text();
    expect(replayText).toBe(text);
    expectPublic(JSON.parse(replayText));
  });

  it("archives, restores and deletes with revision 2 preconditions, refusing repeat transitions", async () => {
    const { data } = await (await post(kind)).json();
    const command = (handler: typeof supplierArchive, suffix: string, tag?: string, body?: unknown) => handler(
      request(kind, "POST", `/${data.id}/${suffix}`, body, tag ? { "if-match": tag } : {}), readParams(data.id));
    for (const [handler, suffix] of [[adapters[kind].archive, "archive"], [adapters[kind].restore, "restore"]] as const) {
      expect((await command(handler, suffix)).status).toBe(428);
    }
    const archived = await command(adapters[kind].archive, "archive", INITIAL_ETAG);
    expect(archived.status).toBe(200);
    expect(archived.headers.get("etag")).toBe('"2.2"');
    const archivedBody = await archived.json();
    expect(archivedBody.data).toMatchObject({ version: 2, archivedAt: expect.any(String) });
    const repeat = await command(adapters[kind].archive, "archive", '"2.2"', {});
    expect(repeat.status).toBe(409);
    expect(await repeat.json()).toMatchObject({ code: "conflict" });
    const restored = await command(adapters[kind].restore, "restore", '"2.2"', {});
    expect(restored.status).toBe(200);
    expect(restored.headers.get("etag")).toBe('"3.2"');
    expect((await restored.json()).data).toMatchObject({ version: 3, archivedAt: null });
    await problem(await command(adapters[kind].restore, "restore", '"3.2"'), 409, "conflict", `/${kind}Id`);
    const missing = await adapters[kind].item.DELETE(request(kind, "DELETE", `/${data.id}`), readParams(data.id));
    expect(missing.status).toBe(428);
    const removed = await adapters[kind].item.DELETE(request(kind, "DELETE", `/${data.id}`, undefined, { "if-match": '"3.2"' }), readParams(data.id));
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe("");
    expect(removed.headers.has("etag")).toBe(false);
  });

  it.each(commands)("requires If-Match and returns the current representation for either stale %s precondition", async command => {
    const row = (await saved(kind)).data;
    const body = command === "patch" ? { name: "New name" } : undefined;
    await problem(await mutate(kind, command, row.id, body, null), 428, "precondition_required");
    const before = await snapshot();
    for (const tag of ['"9.2"', '"1.1"']) {
      const refusal = await problem(await mutate(kind, command, row.id, body, tag), 412, "stale_version");
      expect(refusal.current).toEqual(row);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("refuses archived PATCH before stale row versions and stale representation revisions", async () => {
    const row = (await saved(kind)).data;
    expect((await mutate(kind, "archive", row.id)).status).toBe(200);
    const before = await snapshot();
    for (const tag of [INITIAL_ETAG, '"2.1"', '"2.2"']) {
      await problem(await mutate(kind, "patch", row.id, { name: "Refused" }, tag), 404, "not_found", `/${kind}Id`);
    }
    expect(await snapshot()).toEqual(before);
  });

  it.each(commands)("previews %s with no committed headers, then commits the same domain result", async command => {
    const row = (await saved(kind)).data;
    let tag = INITIAL_ETAG;
    if (command === "restore") { await mutate(kind, "archive", row.id); tag = '"2.2"'; }
    const before = await snapshot();
    const body = command === "patch" ? { name: "Renamed party" } : {};
    const preview = await mutate(kind, command, row.id, body, tag, randomUUID(), "?dryRun=true");
    expect(preview.status).toBe(200);
    expect(preview.headers.get("dry-run")).toBe("true");
    expect(preview.headers.has("etag")).toBe(false);
    expect(preview.headers.has("location")).toBe(false);
    const previewBody = await preview.json();
    expect(await snapshot()).toEqual(before);
    const committed = await mutate(kind, command, row.id, body, tag);
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
    const row = (await saved(kind)).data;
    let tag = INITIAL_ETAG;
    if (command === "restore") { await mutate(kind, "archive", row.id); tag = '"2.2"'; }
    const key = randomUUID();
    const body = command === "patch" ? { name: "Renamed party" } : {};
    const original = await mutate(kind, command, row.id, body, tag, key);
    expect(original.status).toBe(command === "delete" ? 204 : 200);
    const text = await original.text();
    if (command !== "delete") {
      const nextTag = command === "restore" ? '"3.2"' : '"2.2"';
      expect((await mutate(kind, command === "archive" ? "restore" : "archive", row.id, {}, nextTag)).status).toBe(200);
    }
    const before = await snapshot();
    const replay = await mutate(kind, command, row.id.toUpperCase(), body, tag, key);
    expect(replay.status).toBe(original.status);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.headers.get("etag")).toBe(original.headers.get("etag"));
    expect(await replay.text()).toBe(text);
    expect(await snapshot()).toEqual(before);
  });

  it("checks transition versions before state and allows deleting an unused archived party", async () => {
    const row = (await saved(kind)).data;
    const archived = await mutate(kind, "archive", row.id);
    const current = (await archived.json()).data;
    expect((await problem(await mutate(kind, "archive", row.id), 412, "stale_version")).current).toEqual(current);
    await problem(await mutate(kind, "archive", row.id, {}, '"2.2"'), 409, "conflict", `/${kind}Id`);
    expect((await mutate(kind, "delete", row.id, undefined, '"2.2"')).status).toBe(204);
  });

  it("requires party write or delete scope on every actual route", async () => {
    const row = (await saved(kind)).data;
    const before = await snapshot();
    await problem(await adapters[kind].collection.POST(request(kind, "POST", "", input(kind), { "idempotency-key": randomUUID() }, a.readKey)), 403, "missing_scope");
    for (const command of commands) await problem(await mutate(kind, command, row.id, command === "patch" ? {} : undefined, INITIAL_ETAG, undefined, "", a.readKey), 403, "missing_scope");
    await problem(await mutate(kind, "delete", row.id, undefined, INITIAL_ETAG, undefined, "", a.writeKey), 403, "missing_scope");
    for (const command of ["patch", "archive", "restore"] as const) await problem(await mutate(kind, command, row.id, {}, INITIAL_ETAG, undefined, "", a.deleteKey), 403, "missing_scope");
    expect(await snapshot()).toEqual(before);
  });

  it.each(commands)("refuses a party code on %s without writing", async command => {
    const row = (await saved(kind)).data;
    let tag = INITIAL_ETAG;
    if (command === "restore") {
      const archived = await mutate(kind, "archive", row.id);
      expect(archived.status).toBe(200);
      tag = archived.headers.get("etag")!;
    }
    const before = await snapshot();
    await problem(await mutate(kind, command, row.code, command === "patch" ? { name: "Changed by code" } : undefined, tag), 404, "not_found", `/${kind}Id`);
    expect(await snapshot()).toEqual(before);
  });

  it("checks write scopes before parsing malformed JSON on every write route", async () => {
    const row = (await saved(kind)).data;
    const before = await snapshot();
    const malformed = (method: string, suffix: string, headers: Record<string, string>) =>
      new Request(request(kind, method, suffix, {}, headers, a.readKey), { body: "{" });
    await problem(await adapters[kind].collection.POST(malformed("POST", "", { "idempotency-key": randomUUID() })), 403, "missing_scope");
    for (const command of commands) {
      const method = command === "patch" ? "PATCH" : command === "delete" ? "DELETE" : "POST";
      const suffix = command === "archive" || command === "restore" ? `/${command}` : "";
      const handler = { patch: adapters[kind].item.PATCH, delete: adapters[kind].item.DELETE, archive: adapters[kind].archive, restore: adapters[kind].restore }[command];
      await problem(await handler(malformed(method, `/${row.id}${suffix}`, { "if-match": INITIAL_ETAG }), readParams(row.id)), 403, "missing_scope");
    }
    expect(await snapshot()).toEqual(before);
  });

  it("creates three locations with saved pairs and the last explicit default, and previews without writes", async () => {
    const body = { ...input(kind), locations: [location(), { ...location(), name: "Second", isDefault: false }, { ...location(), name: "Last" }] };
    for (const query of ["", "?dryRun=true"]) await problem(await post(kind, body, null, query), 400, "idempotency_key_required");
    const before = await snapshot();
    const key = randomUUID();
    const preview = await post(kind, body, key, "?dryRun=true");
    expect(preview.status).toBe(200);
    expect(preview.headers.get("dry-run")).toBe("true");
    expect(preview.headers.has("etag")).toBe(false);
    expect(preview.headers.has("location")).toBe(false);
    const previewBody = await preview.json();
    expect(await snapshot()).toEqual(before);
    const commit = await post(kind, body, key);
    expect(commit.status).toBe(201);
    const committed = await commit.json();
    expect(committed.locations).toMatchObject([
      { id: expect.any(String), version: 2, isDefault: false, facilityDistances: location().facilityDistances },
      { id: expect.any(String), version: 1, isDefault: false, facilityDistances: location().facilityDistances },
      { id: expect.any(String), version: 1, isDefault: true, facilityDistances: location().facilityDistances },
    ]);
    expect(new Set(committed.locations.map((row: { id: string }) => row.id)).size).toBe(body.locations.length);
    expect(domainFields(committed)).toEqual(domainFields(previewBody));
    const table = kind === "supplier" ? supplierLocations : customerLocations;
    const rows = await db.select().from(table).where(eq(table.organizationId, a.ctx.organizationId));
    for (const child of committed.locations) expect(rows).toContainEqual(expect.objectContaining({ id: child.id, version: child.version, isDefault: child.isDefault }));
    const pairs = kind === "supplier" ? supplierLocationFacilityDistances : customerLocationFacilityDistances;
    const savedPairs = await db.select().from(pairs).where(eq(pairs.organizationId, a.ctx.organizationId));
    for (const child of committed.locations) expect(savedPairs).toContainEqual(expect.objectContaining({ locationId: child.id, ...location().facilityDistances[0] }));
    await problem(await post(kind, body, key, "?dryRun=true"), 409, "key_already_used");
  });

  it("replays byte-identical create bodies through the response builder and refuses changed input", async () => {
    const key = randomUUID();
    const original = await post(kind, input(kind), key);
    expect(original.status).toBe(201);
    const text = await original.text();
    const before = await snapshot();
    const body = input(kind);
    const { locations, ...parent } = body;
    const replay = await post(kind, { locations, ...parent }, key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.headers.get("etag")).toBe(original.headers.get("etag"));
    expect(replay.headers.get("location")).toBe(original.headers.get("location"));
    expect(await replay.text()).toBe(text);
    await problem(await post(kind, { ...body, name: "Different" }, key), 422, "idempotency_key_reused");
    expect(await snapshot()).toEqual(before);
  });

  it("hides foreign ids, codes and nested facility references without writes to either org", async () => {
    const foreign = kind === "customer" ? b.customer.id : (await db.select().from(feedstocks).where(eq(feedstocks.organizationId, b.ctx.organizationId)))[0].supplierId;
    const before = await snapshot();
    const foreignBefore = await snapshot(b);
    for (const id of [foreign, randomUUID()]) for (const command of commands) {
      for (const tag of [INITIAL_ETAG, '\"1.1\"']) await problem(await mutate(kind, command, id, command === "patch" ? {} : undefined, tag), 404, "not_found", `/${kind}Id`);
    }
    const body = { ...input(kind), locations: [{ ...location(), facilityDistances: [{ ...location().facilityDistances[0], facilityId: b.facility.id }] }] };
    await problem(await post(kind, body), 404, "not_found", "/locations/0/facilityDistances/0/facilityId");
    await problem(await post(kind, { ...body, locations: [{ ...body.locations[0], facilityDistances: [{ ...body.locations[0].facilityDistances[0], facilityId: randomUUID() }] }] }), 404, "not_found", "/locations/0/facilityDistances/0/facilityId");
    expect(await snapshot()).toEqual(before);
    expect(await snapshot(b)).toEqual(foreignBefore);
  });

  it("maps duplicate names and codes and gives an archived-name restore hint with scoped metadata", async () => {
    const row = (await saved(kind)).data;
    const other = (await saved(kind, { ...input(kind), name: "Other party" })).data;
    const before = await snapshot();
    await problem(await post(kind, { ...input(kind), name: row.name.toUpperCase() }), 409, "conflict", "/name");
    await problem(await mutate(kind, "patch", other.id, { name: row.name }), 409, "conflict", "/name");
    await problem(await mutate(kind, "patch", other.id, { code: row.code }), 409, "conflict", "/code");
    expect(await snapshot()).toEqual(before);
    expect((await mutate(kind, "archive", row.id)).status).toBe(200);
    const archivedBefore = await snapshot();
    for (const refusal of [await post(kind), await mutate(kind, "patch", other.id, { name: row.name })]) {
      const body = await problem(refusal, 409, "conflict", "/name");
      expect(body.errors).toContainEqual(expect.objectContaining({ pointer: "/name", meta: { [`${kind}Id`]: row.id, archived: true } }));
      expect(body.detail).toContain("Restore it");
    }
    expect(await snapshot()).toEqual(archivedBefore);
  });

  it("refuses private fields and unknown nested properties with exact JSON Pointers", async () => {
    const row = (await saved(kind)).data;
    const before = await snapshot();
    for (const field of ["contactName", "contactEmail", "contactPhone", "address", ...(kind === "supplier" ? ["location"] : [])]) {
      await problem(await post(kind, { ...input(kind), [field]: "Private" }), 422, "validation_failed", `/${field}`);
      await problem(await mutate(kind, "patch", row.id, { [field]: "Private" }), 422, "validation_failed", `/${field}`);
    }
    await problem(await post(kind, { ...input(kind), code: "CALLER" }), 422, "validation_failed", "/code");
    await problem(await post(kind, { ...input(kind), locations: [{ ...location(), extra: true }] }), 422, "validation_failed", "/locations/0/extra");
    if (kind === "supplier") await problem(await post(kind, { ...input(kind), locations: [{ ...location(), address: "Private street" }] }), 422, "validation_failed", "/locations/0/address");
    await problem(await post(kind, { ...input(kind), locations: [{ ...location(), facilityDistances: [{ ...location().facilityDistances[0], extra: true }] }] }), 422, "validation_failed", "/locations/0/facilityDistances/0/extra");
    for (const field of [`${kind}Id`, "expectedVersion", "locations", "extra"]) await problem(await mutate(kind, "patch", row.id, { [field]: true }), 422, "validation_failed", `/${field}`);
    for (const command of ["delete", "archive", "restore"] as const) {
      await problem(await mutate(kind, command, row.id, { extra: true }), 422, "validation_failed", "/extra");
      for (const body of [null, [], true]) await problem(await mutate(kind, command, row.id, body), 422, "validation_failed");
    }
    expect(await snapshot()).toEqual(before);
  });

  it.each([5e-324, 20_000.001])("refuses out-of-bounds distance %s before saving", async distanceKm => {
    const before = await snapshot();
    await problem(await post(kind, { ...input(kind), locations: [{ ...location(), facilityDistances: [{ ...location().facilityDistances[0], distanceKm }] }] }), 422, "validation_failed", "/locations/0/facilityDistances/0/distanceKm");
    expect(await snapshot()).toEqual(before);
  });

  it("deletes every unreferenced child and pair with a bodyless 204", async () => {
    const row = await saved(kind);
    const response = await mutate(kind, "delete", row.data.id);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.has("etag")).toBe(false);
    expect(response.headers.has("location")).toBe(false);
    const table = kind === "supplier" ? supplierLocations : customerLocations;
    expect(await db.select().from(table).where(eq(table.id, row.locations[0].id))).toEqual([]);
    const pairs = kind === "supplier" ? supplierLocationFacilityDistances : customerLocationFacilityDistances;
    expect(await db.select().from(pairs).where(eq(pairs.locationId, row.locations[0].id))).toEqual([]);
  });

  it.each([false, true])("refuses deletes with linked-record blockers, archived reference: %s", async archived => {
    const [fixtureIntake] = await db.select().from(feedstocks).where(eq(feedstocks.organizationId, a.ctx.organizationId));
    const row = kind === "supplier" ? { data: { id: fixtureIntake.supplierId }, locations: [] } : await saved(kind);
    let meta: Record<string, unknown>;
    if (kind === "supplier") {
      const [intake] = await db.update(feedstocks).set({ supplierId: row.data.id, archivedAt: archived ? new Date() : null })
        .where(eq(feedstocks.organizationId, a.ctx.organizationId)).returning();
      meta = { feedstockCodes: [intake.code] };
    } else {
      const order = await insertReadOrder(a, "PARTY-ORDER", { customerId: row.data.id, customerLocationId: row.locations[0].id, archivedAt: archived ? new Date() : null });
      meta = { orderCodes: [order.code] };
    }
    const before = await snapshot();
    const refusal = await problem(await mutate(kind, "delete", row.data.id), 409, "conflict", `/${kind}Id`);
    expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: `/${kind}Id`, meta }));
    expect(await snapshot()).toEqual(before);
  });

  it("matches app create and update on shared fields through the same writers", async () => {
    const rest = await saved(kind);
    auth.session.mockResolvedValue({ user: { id: b.ctx.userId }, session: { activeOrganizationId: b.ctx.organizationId } });
    const site = { ...location(), facilityDistances: [{ ...location().facilityDistances[0], facilityId: b.facility.id }] };
    let appId: string;
    if (kind === "supplier") {
      const action = await createSupplierWithLocationsFn({ supplier: { name: input(kind).name, sourceRegion: "Mbeya" }, locations: [site] });
      expect(action.success).toBe(true);
      if (!action.success) throw new Error("App supplier create failed");
      appId = action.data.id;
    } else {
      const action = await createCustomerWithLocationsFn({ customer: { name: input(kind).name, cropType: "Coffee" }, locations: [site] });
      expect(action.success).toBe(true);
      if (!action.success) throw new Error("App customer create failed");
      appId = action.data.customer.id;
    }
    const readApp = async () => {
      const response = await adapters[kind].item.GET(readRequest(`/${kind}s/${appId}`, b.partyKey), readParams(appId));
      expect(response.status).toBe(200);
      return (await response.json()).data;
    };
    const app = await readApp();
    expect(domainFields({ ...app, code: undefined })).toEqual(domainFields({ ...rest.data, code: undefined }));
    const fields = kind === "supplier" ? { sourceRegion: null } : { cropType: null };
    const restChanged = await mutate(kind, "patch", rest.data.id, { name: "Renamed", ...fields });
    expect(restChanged.status).toBe(200);
    const changed = kind === "supplier"
      ? await updateSupplierFn({ supplierId: appId, expectedVersion: 1, name: "Renamed", sourceRegion: null })
      : await updateCustomerFn({ customerId: appId, expectedVersion: 1, name: "Renamed", cropType: null });
    expect(changed.success).toBe(true);
    const appChanged = await readApp();
    expect(appChanged.version).toBe(2);
    expect(domainFields({ ...appChanged, code: undefined })).toEqual(domainFields({ ...(await restChanged.json()).data, code: undefined }));
    const table = kind === "supplier" ? supplierLocations : customerLocations;
    expect(await db.select().from(table).where(eq(table.organizationId, b.ctx.organizationId)))
      .toContainEqual(expect.objectContaining({ name: site.name, country: site.country, gpsLatitude: site.gpsLatitude, gpsLongitude: site.gpsLongitude, isDefault: true, version: 1 }));
  });
});

it("returns customer site defaults on create and the location list", async () => {
  const defaults = { siteDescription: "Field beside the river", defaultSoilTemperatureC: 24.5 };
  const response = await post("customer", { ...input("customer"), locations: [{ ...location(), ...defaults }] });
  expect(response.status).toBe(201);
  const created = await response.json();
  expect(created.locations).toEqual([expect.objectContaining(defaults)]);
  const listed = await customerLocationList(readRequest(`/customers/${created.data.id}/locations`, a.partyKey), readParams(created.data.id));
  expect(listed.status).toBe(200);
  expect((await listed.json()).data).toEqual([expect.objectContaining({ id: created.locations[0].id, ...defaults })]);
}, TIMEOUT_MS);

it("refuses customer deletion for a registered storage-site location without removing any child", async () => {
  const row = await saved("customer", { ...input("customer"), locations: [location(), { ...location(), name: "Registered field" }] });
  const id = row.locations[1].id;
  const [project] = await db.insert(certifierProjects).values({ organizationId: a.ctx.organizationId, facilityId: a.facility.id, provider: "isometric", externalProjectId: `prj-${id}`, externalFacilityId: `fcl-${id}` }).returning();
  await db.insert(certifierStorageLocations).values({ organizationId: a.ctx.organizationId, customerLocationId: id, certifierProjectId: project.id,
    externalProjectId: project.externalProjectId, externalStorageLocationId: `slc-${id}`, supplierReference: id, payloadHash: "test",
    submittedPayload: buildCreateStorageLocationRequest({ externalProjectId: project.externalProjectId, name: "Registered field", latitude: -8, longitude: 34, supplierReferenceId: id }),
  });
  const before = await snapshot();
  const refusal = await problem(await mutate("customer", "delete", row.data.id), 409, "conflict", "/customerId");
  expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: "/customerId", meta: { locationIds: [id] } }));
  expect(await snapshot()).toEqual(before);
}, TIMEOUT_MS);
