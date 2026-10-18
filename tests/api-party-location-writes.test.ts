import { and, eq, notExists } from "drizzle-orm";
import { db } from "@/db";
import { feedstocks, supplierLocations, suppliers } from "@/db/schema";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
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
import { createApiOrderReadFixture, removeApiOrderReadFixture, readParams } from "./helpers/api-order-read-fixture";

const TIMEOUT_MS = 60_000;
const INITIAL_ETAG = '"1.1"';
type Kind = "supplier" | "customer";
type Command = "patch" | "delete" | "archive" | "restore";
const adapters = {
  supplier: { collection: supplierCollection, item: supplierItem, create: createSupplier, archive: archiveSupplier },
  customer: { collection: customerCollection, item: customerItem, create: createCustomer, archive: archiveCustomer },
};
const site = { name: "North field", country: "Tanzania", gpsLatitude: -8, gpsLongitude: 34 };
type Fixture = Awaited<ReturnType<typeof fixture>>;
let a: Fixture;
let b: Fixture;
async function fixture() {
  const f = await createApiOrderReadFixture();
  const { key } = await createApiKey(f.ctx, { name: "Location route fixture", expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS,
    scopes: ["suppliers:read", "suppliers:write", "suppliers:delete", "customers:read", "customers:write", "customers:delete"] });
  return { ...f, partyKey: key };
}
beforeEach(async () => { a = await fixture(); b = await fixture(); }, TIMEOUT_MS);
afterEach(async () => {
  for (const f of [a, b]) if (f) {
    await db.delete(supplierLocations).where(eq(supplierLocations.organizationId, f.ctx.organizationId));
    await db.delete(suppliers).where(and(eq(suppliers.organizationId, f.ctx.organizationId), notExists(
      db.select({ id: feedstocks.id }).from(feedstocks).where(eq(feedstocks.supplierId, suppliers.id)),
    )));
    await removeApiOrderReadFixture(f);
  }
}, TIMEOUT_MS);
function request(path: string, method: string, body?: unknown, headers: Record<string, string> = {}, key = a.partyKey) {
  return new Request(`http://localhost:3100/api/v1${path}`, { method, headers: {
    authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers,
  }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function parent(kind: Kind, f = a) {
  const response = await adapters[kind].create(request(`/${kind}s`, "POST", { name: randomUUID(), locations: [site] }, { "idempotency-key": randomUUID() }, f.partyKey));
  expect(response.status).toBe(201);
  return await response.json() as { data: { id: string; code: string }; locations: { id: string }[] };
}
function add(kind: Kind, id: string, body: unknown = site, key: string | null = randomUUID(), query = "", credential = a.partyKey) {
  return adapters[kind].collection.POST(request(`/${kind}s/${id}/locations${query}`, "POST", body, key ? { "idempotency-key": key } : {}, credential), readParams(id));
}
function mutate(kind: Kind, command: Command, id: string, locationId: string, body?: unknown, tag: string | null = INITIAL_ETAG, key?: string, query = "", credential = a.partyKey) {
  const handler = command === "patch" ? adapters[kind].item.PATCH : command === "delete" ? adapters[kind].item.DELETE : command === "archive" ? archiveLocation : restoreLocation;
  const suffix = command === "archive" || command === "restore" ? `/${command}` : "";
  return handler(request(`/${kind}s/${id}/locations/${locationId}${suffix}${query}`, command === "patch" ? "PATCH" : command === "delete" ? "DELETE" : "POST", body,
    { ...(tag ? { "if-match": tag } : {}), ...(key ? { "idempotency-key": key } : {}) }, credential), { params: Promise.resolve({ idOrCode: id, locationId }) });
}
async function problem(response: Response, status: number, code: string, pointer?: string) {
  expect(response.status).toBe(status);
  const body = await response.json();
  expect(body.code).toBe(code);
  if (pointer) expect(body.errors).toContainEqual(expect.objectContaining({ pointer }));
  return body;
}
async function read(kind: Kind, id: string, locationId: string) {
  return adapters[kind].item.GET(request(`/${kind}s/${id}/locations/${locationId}`, "GET"), { params: Promise.resolve({ idOrCode: id, locationId }) });
}

describe.each(["supplier", "customer"] as const)("%s location REST writes", kind => {
  it("requires create keys even on dry runs and returns canonical child headers with replay", async () => {
    const { data } = await parent(kind);
    for (const query of ["", "?dryRun=true"]) await problem(await add(kind, data.id, site, null, query), 400, "idempotency_key_required");
    const key = randomUUID();
    const preview = await add(kind, data.id, site, key, "?dryRun=true");
    expect(preview.status).toBe(200);
    expect(preview.headers.get("dry-run")).toBe("true");
    expect(preview.headers.has("etag")).toBe(false);
    expect(preview.headers.has("location")).toBe(false);
    const previewBody = await preview.json();
    expect((await read(kind, data.id, previewBody.data.id)).status).toBe(404);
    const response = await add(kind, data.id.toUpperCase(), site, key);
    expect(response.status).toBe(201);
    expect(response.headers.get("etag")).toBe(INITIAL_ETAG);
    const text = await response.text();
    const body = JSON.parse(text);
    expect(response.headers.get("location")).toBe(`/api/v1/${kind}s/${data.id}/locations/${body.data.id}`);
    expect(await (await read(kind, data.id, body.data.id)).json()).toEqual({ data: body.data });
    const replay = await add(kind, data.id, site, key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(await replay.text()).toBe(text);
    await problem(await add(kind, data.id, site, key, "?dryRun=true"), 409, "key_already_used");
  });
  const commands: Command[] = kind === "customer" ? ["patch", "delete", "archive", "restore"] : ["patch", "delete"];
  it("checks child preconditions, UUID paths, unknown keys and each route's scope", async () => {
    const { data, locations } = await parent(kind);
    const id = locations[0].id;
    await problem(await add(kind, data.code), 404, "not_found");
    await problem(await add(kind, data.id, { ...site, extra: true }), 422, "validation_failed", "/extra");
    await problem(await add(kind, data.id, { ...site, facilityDistances: [{ facilityId: a.facility.id, distanceKm: 5, distanceSource: "manual", extra: true }] }), 422, "validation_failed", "/facilityDistances/0/extra");
    await problem(await add(kind, data.id, site, randomUUID(), "", a.missingScopeKey), 403, "missing_scope");
    for (const command of commands) {
      const body = command === "patch" ? { city: "Mbeya" } : undefined;
      await problem(await mutate(kind, command, data.id, id, body, null), 428, "precondition_required");
      for (const tag of ['"99.1"', '"1.99"']) {
        const stale = await problem(await mutate(kind, command, data.id, id, body, tag), 412, "stale_version");
        expect(stale.current).toMatchObject({ id, version: 1 });
      }
      await problem(await mutate(kind, command, data.code, id, body), 404, "not_found", "/locationId");
      await problem(await mutate(kind, command, data.id, "not-a-uuid", body), 404, "not_found", "/locationId");
      await problem(await mutate(kind, command, data.id, id, { extra: true }), 422, "validation_failed", "/extra");
      await problem(await mutate(kind, command, data.id, id, body, INITIAL_ETAG, undefined, "", a.missingScopeKey), 403, "missing_scope");
    }
    for (const field of ["locationId", `${kind}Id`, "expectedVersion"]) {
      await problem(await add(kind, data.id, { ...site, [field]: id }), 422, "validation_failed", `/${field}`);
      await problem(await mutate(kind, "patch", data.id, id, { [field]: id }), 422, "validation_failed", `/${field}`);
    }
    await problem(await mutate(kind, "patch", data.id, id, {}), 422, "validation_failed");
  });

  it("updates uppercase UUIDs, previews without changing the child and replays after deletion", async () => {
    const { data } = await parent(kind);
    const added = await add(kind, data.id);
    const { data: child } = await added.json();
    const preview = await mutate(kind, "patch", data.id, child.id, { city: "Mbeya" }, INITIAL_ETAG, undefined, "?dryRun=true");
    expect(preview.status).toBe(200);
    expect(preview.headers.get("dry-run")).toBe("true");
    expect(preview.headers.has("etag")).toBe(false);
    expect((await (await read(kind, data.id, child.id)).json()).data.city).toBeNull();
    const key = randomUUID();
    const changed = await mutate(kind, "patch", data.id.toUpperCase(), child.id.toUpperCase(), { city: "Mbeya" }, INITIAL_ETAG, key);
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).toBe('"2.1"');
    const text = await changed.text();
    const previewDelete = await mutate(kind, "delete", data.id, child.id, undefined, '"2.1"', undefined, "?dryRun=true");
    expect(previewDelete.status).toBe(200);
    expect((await previewDelete.json()).data).toEqual(JSON.parse(text).data);
    expect(previewDelete.headers.get("dry-run")).toBe("true");
    expect(previewDelete.headers.has("etag")).toBe(false);
    const deleteKey = randomUUID();
    const deleted = await mutate(kind, "delete", data.id, child.id, undefined, '"2.1"', deleteKey);
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    expect(deleted.headers.has("etag")).toBe(false);
    expect(deleted.headers.has("location")).toBe(false);
    expect((await read(kind, data.id, child.id)).status).toBe(404);
    const replay = await mutate(kind, "patch", data.id, child.id, { city: "Mbeya" }, INITIAL_ETAG, key);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(await replay.text()).toBe(text);
    const deleteReplay = await mutate(kind, "delete", data.id, child.id, undefined, '"2.1"', deleteKey);
    expect(deleteReplay.status).toBe(204);
    expect(deleteReplay.headers.get("idempotent-replayed")).toBe("true");
  });

  it("hides wrong-parent and foreign children before both stale preconditions", async () => {
    const own = await parent(kind);
    const other = await parent(kind);
    const foreign = await parent(kind, b);
    for (const command of commands) for (const tag of [INITIAL_ETAG, '"99.1"', '"99.99"']) {
      for (const [id, child] of [[own.data.id, other.locations[0].id], [own.data.id, foreign.locations[0].id], [foreign.data.id, foreign.locations[0].id], [foreign.data.id, own.locations[0].id], [randomUUID(), own.locations[0].id]]) {
        await problem(await mutate(kind, command, id, child, command === "patch" ? { city: "Mbeya" } : undefined, tag), 404, "not_found", "/locationId");
      }
    }
    await problem(await add(kind, foreign.data.id), 404, "not_found", `/${kind}Id`);
  });

  it("refuses an archived parent before stale row versions or revisions", async () => {
    const { data, locations } = await parent(kind);
    const archived = await adapters[kind].archive(request(`/${kind}s/${data.id}/archive`, "POST", undefined, { "if-match": '"1.2"' }), readParams(data.id));
    expect(archived.status).toBe(200);
    await problem(await add(kind, data.id), 404, "not_found", `/${kind}Id`);
    for (const command of commands) for (const tag of ['"99.1"', '"99.99"']) {
      await problem(await mutate(kind, command, data.id, locations[0].id, command === "patch" ? { city: "Mbeya" } : undefined, tag), 404, "not_found", `/${kind}Id`);
    }
  });

});


describe("customer location transitions", () => {
  it("previews, archives and restores with child ETags, state conflicts and durable replay", async () => {
    const { data, locations } = await parent("customer");
    expect((await add("customer", data.id)).status).toBe(201);
    const id = locations[0].id;
    for (const command of ["archive", "restore"] as const) {
      const tag = command === "archive" ? INITIAL_ETAG : '"2.1"';
      const nextTag = command === "archive" ? '"2.1"' : '"3.1"';
      const preview = await mutate("customer", command, data.id, id, undefined, tag, undefined, "?dryRun=true");
      expect(preview.status).toBe(200);
      expect(preview.headers.get("dry-run")).toBe("true");
      expect(preview.headers.has("etag")).toBe(false);
      expect(preview.headers.has("location")).toBe(false);
      expect((await read("customer", data.id, id)).headers.get("etag")).toBe(tag);
      const key = randomUUID();
      const response = await mutate("customer", command, data.id.toUpperCase(), id.toUpperCase(), undefined, tag, key);
      expect(response.status).toBe(200);
      expect(response.headers.get("etag")).toBe(nextTag);
      const text = await response.text();
      expect(JSON.parse(text).data.archivedAt === null).toBe(command === "restore");
      await problem(await mutate("customer", command, data.id, id, undefined, tag), 412, "stale_version");
      await problem(await mutate("customer", command, data.id, id, undefined, nextTag), 409, "conflict", "/locationId");
      const replay = await mutate("customer", command, data.id, id, undefined, tag, key);
      expect(replay.headers.get("idempotent-replayed")).toBe("true");
      expect(await replay.text()).toBe(text);
      if (command === "archive") {
        expect(JSON.parse(text).warnings).toEqual([expect.stringContaining("default location")]);
        for (const stale of [INITIAL_ETAG, '"1.99"']) await problem(await mutate("customer", "patch", data.id, id, { city: "Mbeya" }, stale), 404, "not_found", "/locationId");
        for (const next of ["delete", "archive", "restore"] as const) for (const stale of [INITIAL_ETAG, '"1.99"']) {
          await problem(await mutate("customer", next, data.id, id, undefined, stale), 412, "stale_version");
        }
      }
    }
  });
  it("replays a successful PATCH after the location is archived", async () => {
    const { data } = await parent("customer");
    const { data: child } = await (await add("customer", data.id)).json();
    const key = randomUUID();
    const changed = await mutate("customer", "patch", data.id, child.id, { city: "Mbeya" }, INITIAL_ETAG, key);
    const text = await changed.text();
    expect((await mutate("customer", "archive", data.id, child.id, undefined, '"2.1"')).status).toBe(200);
    const replay = await mutate("customer", "patch", data.id, child.id, { city: "Mbeya" }, INITIAL_ETAG, key);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(await replay.text()).toBe(text);
  });
});
