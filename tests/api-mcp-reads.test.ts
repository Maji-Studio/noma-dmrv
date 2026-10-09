/** Real keys and handlers. Not run by the implementation agent; needs the supervisor. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, drivers, facilities, feedstocks, feedstockTypes, organizationApiAccess, storageLocations, supplierLocations, suppliers, vehicles } from "@/db/schema";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { API_LIST_MAX_LIMIT } from "@/config/api-rest";
import { createApiKey, revokeApiKey } from "@/data-access/api-keys";
import { POST } from "@/app/api/mcp/route";
import { GET as ME } from "@/app/api/v1/me/route";
import { GET as FACILITIES } from "@/app/api/v1/facilities/route";
import { GET as SUPPLIERS } from "@/app/api/v1/suppliers/route";
import { GET as LOCATIONS } from "@/app/api/v1/suppliers/[idOrCode]/locations/route";
import { GET as TYPES } from "@/app/api/v1/feedstock-types/route";
import { GET as BINS } from "@/app/api/v1/storage-locations/route";
import { GET as VEHICLES } from "@/app/api/v1/vehicles/route";
import { GET as DRIVERS } from "@/app/api/v1/drivers/route";
import { GET as FEEDSTOCKS } from "@/app/api/v1/feedstocks/route";
import { GET as FEEDSTOCK } from "@/app/api/v1/feedstocks/[idOrCode]/route";
import { createLookupFixture, removeLookupFixture, lookupParams, lookupRequest, LOOKUP_SUITE_TIMEOUT_MS, type LookupFixture } from "./helpers/api-lookups";

const PAGE_SIZE = 1;
const ROW_COUNT = 2;
const PREFIX = "MCP-";
let a: LookupFixture;
let b: LookupFixture;
let rows: { id: string; code: string }[];
let foreignRows: { id: string; code: string }[];

function rpc(key: string, method: string, params: Record<string, unknown> = {}) {
  return new Request("http://localhost:3100/api/mcp", { method: "POST", headers: {
    authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-06-18",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}
async function rpcBody(response: Response) {
  const text = await response.text();
  return JSON.parse(text.trim().startsWith("{") ? text : text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice("data:".length)).join(""));
}
async function call(name: string, args: Record<string, unknown> = {}, key = a.key) {
  const response = await POST(rpc(key, "tools/call", { name, arguments: args }));
  expect(response.status).toBe(200);
  return rpcBody(response);
}
function query(args: Record<string, unknown>) {
  return `?${new URLSearchParams(Object.entries(args).map(([key, value]) => [key, String(value)]))}`;
}
async function seed(fixture: LookupFixture) {
  const organizationId = fixture.ctx.organizationId;
  for (let index = 0; index < ROW_COUNT; index++) {
    const shared = { organizationId, code: `${PREFIX}${index}`, name: `MCP name ${index}` };
    await db.insert(facilities).values(shared);
    await db.insert(suppliers).values(shared);
    await db.insert(feedstockTypes).values({ ...shared, category: "forestry", usage: "pyrolysis" });
    await db.insert(storageLocations).values({ ...shared, facilityId: fixture.facilityId, type: "feedstock_bin" });
    await db.insert(vehicles).values({ ...shared, vehicleType: "truck", identifier: `MCP vehicle ${index}` });
    await db.insert(drivers).values(shared);
    await db.insert(supplierLocations).values({ organizationId, supplierId: fixture.supplierId, name: `${PREFIX}${index}` });
  }
  return db.insert(feedstocks).values(Array.from({ length: ROW_COUNT }, (_, index) => ({
    organizationId, facilityId: fixture.facilityId, feedstockTypeId: fixture.feedstockTypeId,
    storageLocationId: fixture.binId, supplierId: fixture.supplierId, code: `${PREFIX}${index}`,
    status: "complete" as const, deliveryDate: new Date("2026-10-06T00:00:00Z"), massWetKg: 100, massDryKg: 70, moistureContentPercent: 30,
  }))).returning({ id: feedstocks.id, code: feedstocks.code });
}

beforeEach(async () => {
  a = await createLookupFixture();
  b = await createLookupFixture();
  rows = await seed(a);
  foreignRows = await seed(b);
});
afterEach(async () => { await removeLookupFixture(a); await removeLookupFixture(b); });

const collections = [
  { resource: "facilities", name: "find_facilities", get: FACILITIES },
  { resource: "suppliers", name: "find_suppliers", get: SUPPLIERS },
  { resource: "feedstock-types", name: "find_feedstock_types", get: TYPES },
  { resource: "storage-locations", name: "find_storage_locations", get: BINS },
  { resource: "vehicles", name: "find_vehicles", get: VEHICLES },
  { resource: "drivers", name: "find_drivers", get: DRIVERS },
  { resource: "feedstocks", name: "find_feedstocks", get: FEEDSTOCKS },
];

describe("MCP reads with real API keys", { timeout: LOOKUP_SUITE_TIMEOUT_MS }, () => {
  it("matches whoami to REST with the same key", async () => {
    const response = await ME(lookupRequest("me", "", a.key));
    expect(response.status).toBe(200);
    const rest = await response.json();
    const { result } = await call("whoami");
    expect(result.structuredContent).toEqual(rest);
    expect(result.content).toEqual([{ type: "text", text: `Organization ${rest.data.organization.name}, ${rest.data.facilities.length} facilities, role ${rest.data.role}.` }]);
  });
  it.each(collections)("matches $name filtered pages and shares cursors in both directions", async ({ resource, name, get }) => {
    const args = { q: PREFIX, limit: PAGE_SIZE };
    const response = await get(lookupRequest(resource, query(args), a.key));
    expect(response.status).toBe(200);
    const first = await response.json();
    expect(first.data).toHaveLength(PAGE_SIZE);
    expect(first.nextCursor).toBeTruthy();
    const { result } = await call(name, args);
    expect(result.content).toEqual([{ type: "text", text: `${PAGE_SIZE} ${resource.replaceAll("-", " ")}. More results: pass nextCursor.` }]);
    const mcpFirst = result.structuredContent;
    expect(mcpFirst).toEqual(first);
    const nextArgs = { ...args, cursor: first.nextCursor };
    const second = await (await get(lookupRequest(resource, query(nextArgs), a.key))).json();
    expect(second.data).toHaveLength(PAGE_SIZE);
    expect((await call(name, nextArgs)).result.structuredContent).toEqual(second);
    expect(await (await get(lookupRequest(resource, query({ ...args, cursor: mcpFirst.nextCursor }), a.key))).json()).toEqual(second);
    expect((await call(name, { code: `${PREFIX}0` })).result.structuredContent)
      .toEqual(await (await get(lookupRequest(resource, query({ code: `${PREFIX}0` }), a.key))).json());
  });
  it("matches supplier-location filtering and paging with REST cursors", async () => {
    const args = { q: PREFIX, limit: PAGE_SIZE };
    const rest = (input: Record<string, unknown>) => LOCATIONS(lookupRequest("suppliers", `/${a.supplierId}/locations${query(input)}`, a.key), lookupParams(a.supplierId));
    const first = await (await rest(args)).json();
    expect(first.nextCursor).toBeTruthy();
    expect((await call("find_supplier_locations", { ...args, supplierId: a.supplierId })).result.structuredContent).toEqual(first);
    const next = { ...args, cursor: first.nextCursor };
    expect((await call("find_supplier_locations", { ...next, supplierId: a.supplierId })).result.structuredContent).toEqual(await (await rest(next)).json());
  });
  it("reports invalid supplier identifiers at the MCP argument name", async () => {
    const { result } = await call("find_supplier_locations", { supplierId: "not-a-uuid" });
    expect(result).toMatchObject({ isError: true, structuredContent: {
      code: "invalid_query", issues: [{ pointer: "/supplierId" }],
    } });
  });
  it("matches feedstock detail by id and by code", async () => {
    for (const idOrCode of [rows[0].id, rows[0].code]) {
      const response = await FEEDSTOCK(lookupRequest("feedstocks", `/${idOrCode}`, a.key), lookupParams(idOrCode));
      expect(response.status).toBe(200);
      const rest = await response.json();
      const { result } = await call("get_feedstock", { idOrCode });
      expect(result.structuredContent).toEqual(rest);
      expect(result.content).toEqual([{ type: "text", text: `Feedstock ${rest.data.code}, version ${rest.data.version}.` }]);
    }
  });
  it("filters scopes and refuses hidden tools exactly like unknown tools", async () => {
    const restricted = await createApiKey(a.ctx, { name: "MCP suppliers only", scopes: ["suppliers:read"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS });
    const { result } = await rpcBody(await POST(rpc(restricted.key, "tools/list")));
    expect(result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual(["find_supplier_locations", "find_suppliers", "whoami"]);
    const hidden = await call("find_feedstocks", {}, restricted.key);
    expect(hidden.error).toEqual((await call("unknown_tool", {}, restricted.key)).error);
    expect(hidden).not.toHaveProperty("result");
  });
  it("refuses foreign feedstock ids and codes, supplier parents and facilities without data", async () => {
    // Fixture codes intentionally overlap; use a unique foreign code to test code BOLA.
    const foreignCode = "FOREIGN-MCP";
    await db.update(feedstocks).set({ code: foreignCode }).where(eq(feedstocks.id, foreignRows[0].id));
    for (const [name, args] of [
      ["get_feedstock", { idOrCode: foreignRows[0].id }], ["get_feedstock", { idOrCode: foreignCode }],
      ["find_supplier_locations", { supplierId: b.supplierId }], ["find_storage_locations", { facilityId: b.facilityId }],
    ] as const) {
      const { result } = await call(name, args);
      expect(result).toMatchObject({ isError: true, structuredContent: { code: "not_found" } });
      expect(result.structuredContent).not.toHaveProperty("data");
    }
  });
  it.each([{ unknown: true }, { limit: API_LIST_MAX_LIMIT + 1 }, { cursor: "malformed" }])("matches REST validation codes and preserves MCP query issue paths for %j", async (args) => {
    const rest = await (await FEEDSTOCKS(lookupRequest("feedstocks", query(args), a.key))).json();
    const { result } = await call("find_feedstocks", args);
    expect(result.isError).toBe(true);
    expect(result.structuredContent.code).toBe(rest.code);
    if ("cursor" in args) expect(result.structuredContent.issues).toEqual(rest.errors);
    else expect(result.structuredContent.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ pointer: "limit" in args ? "/limit" : "" }),
    ]));
    expect(result.structuredContent).not.toHaveProperty("data");
  });
  it.each(["revoked", "expired"])("answers a %s key with HTTP 401", async (state) => {
    const key = await createApiKey(a.ctx, { name: "MCP denial", scopes: ["feedstocks:read"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS });
    if (state === "revoked") await revokeApiKey(a.ctx, { id: key.id, expectedVersion: 1 });
    else await db.update(apiKeys).set({ expiresAt: new Date(0) }).where(eq(apiKeys.id, key.id));
    const response = await POST(rpc(key.key, "tools/list"));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
  });
  it("answers disabled organization access at HTTP level", async () => {
    await db.insert(organizationApiAccess).values({ organizationId: a.ctx.organizationId, enabled: false, changedByUserId: a.ctx.userId });
    const response = await POST(rpc(a.key, "tools/list"));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "api_access_disabled" });
  });
});
