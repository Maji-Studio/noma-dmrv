import { getOAuthConfig } from "@/lib/auth/oauth-config";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { suppliers, facilities, supplierLocations } from "@/db/schema";
import { API_SCOPES } from "@/lib/auth/api-scopes";
import { resolveApiContext, type ApiContext } from "@/lib/auth/api-context";
import { readTools } from "@/lib/mcp/tools/read-tools";
import { GET, PATCH } from "@/app/api/v1/suppliers/[idOrCode]/route";
import { GET as LIST } from "@/app/api/v1/suppliers/route";
import { GET as FEEDSTOCKS } from "@/app/api/v1/feedstocks/route";
import { runOperationInProcess } from "@/lib/operations/runner";
import { operationRegistry } from "@/lib/operations/registry";
import { createOAuthFixture, type OAuthFixture } from "./helpers/oauth";
import { TEST_SITE_POSITION } from "./helpers/test-org";

vi.mock("@/config/env", async importOriginal => {
  const original = await importOriginal<typeof import("@/config/env")>();
  return { ...original, env: { ...original.env, OAUTH_PROVIDER_ENABLED: true } };
});
let f: OAuthFixture;
let a: Awaited<ReturnType<OAuthFixture["accessToken"]>>;
let b: typeof a;
let ctx: ApiContext;
let foreignId: string;
let foreignFacilityId: string;
beforeEach(async () => {
  f = await createOAuthFixture();
  a = await f.accessToken({ scopes: API_SCOPES.filter(scope => !scope.endsWith(":delete")) });
  b = await f.accessToken({ organizationIndex: 1, scopes: ["suppliers:read"] });
  const resolved = await resolveApiContext(a.request(), getOAuthConfig().rest);
  if (!resolved.ok) throw new Error(resolved.denial);
  ctx = resolved.ctx;
  const rows = await db.insert(suppliers).values([0, 1].map(i => ({ organizationId: f.orgIds[1], code: `OAUTH-${i}`, name: `E2E OAuth foreign supplier ${i}` }))).returning();
  foreignId = rows[0].id;
  const [facility] = await db.insert(facilities).values({ ...TEST_SITE_POSITION, timezone: "UTC", organizationId: f.orgIds[1], code: "OAUTH-FAC", name: "E2E OAuth foreign facility" }).returning();
  foreignFacilityId = facility.id;
});
afterEach(async () => {
  await db.delete(supplierLocations).where(inArray(supplierLocations.organizationId, f.orgIds));
  await db.delete(suppliers).where(inArray(suppliers.organizationId, f.orgIds));
  await db.delete(facilities).where(inArray(facilities.organizationId, f.orgIds));
  await f.cleanup();
});
const params = (id: string) => ({ params: Promise.resolve({ idOrCode: id }) });
it("a person in both organizations cannot read or update B using A's generation", async () => {
  expect((await GET(a.request(`/api/v1/suppliers/${foreignId}`), params(foreignId))).status).toBe(404);
  expect((await GET(b.request(`/api/v1/suppliers/${foreignId}`), params(foreignId))).status).toBe(200);
  const base = a.request(`/api/v1/suppliers/${foreignId}`);
  const headers = new Headers(base.headers);
  headers.set("content-type", "application/json"); headers.set("if-match", '"1.1"');
  const response = await PATCH(new Request(base, { method: "PATCH", headers, body: JSON.stringify({ name: "E2E attempted cross-org edit" }) }), params(foreignId));
  expect(response.status).toBe(404);
  expect(await db.query.suppliers.findFirst({ where: eq(suppliers.id, foreignId) })).toMatchObject({ name: "E2E OAuth foreign supplier 0", version: 1 });
});
it("foreign body ids are refused without a write", async () => {
  await expect(runOperationInProcess(operationRegistry.update_supplier, ctx, { supplierId: foreignId, expectedVersion: 1, name: "E2E attempted edit" })).rejects.toMatchObject({ code: "not_found" });
  expect(await db.query.suppliers.findFirst({ where: eq(suppliers.id, foreignId) })).toMatchObject({ version: 1 });
});
it("foreign facility filters do not reveal rows", async () => {
  expect((await FEEDSTOCKS(a.request(`/api/v1/feedstocks?facilityId=${foreignFacilityId}`))).status).toBe(404);
});
it("cursors remain organization-bound with the existing invalid_cursor contract", async () => {
  const page = await (await LIST(b.request("/api/v1/suppliers?limit=1"))).json();
  expect(page.nextCursor).toEqual(expect.any(String));
  const response = await LIST(a.request(`/api/v1/suppliers?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "invalid_cursor" });
});
it("MCP tool arguments retain the same organization boundary", async () => {
  const tool = readTools.find(tool => tool.name === "find_supplier_locations")!;
  expect(tool).toBeDefined();
  await expect(tool.execute(ctx, { supplierId: foreignId })).rejects.toMatchObject({ code: "not_found" });
  await expect(tool.execute(ctx, { supplierId: randomUUID() })).rejects.toMatchObject({ code: "not_found" });
});
