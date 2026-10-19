/** Real REST/MCP handlers and Postgres. Supervisor runs this suite. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customerLocations, customers, supplierLocations, suppliers, facilities, customerLocationFacilityDistances, supplierLocationFacilityDistances } from "@/db/schema";
import { GET as CUSTOMER } from "@/app/api/v1/customers/[idOrCode]/locations/[locationId]/route";
import { GET as SUPPLIER } from "@/app/api/v1/suppliers/[idOrCode]/locations/[locationId]/route";
import { GET as LIST } from "@/app/api/v1/customers/[idOrCode]/locations/route";
import { POST as MCP } from "@/app/api/mcp/route";
import { customerLocationRepresentationSchema } from "@/lib/representations/customer-locations";
import { supplierLocationRepresentationSchema } from "@/lib/representations/supplier-locations";
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { lookupProblem } from "./helpers/api-lookups";
import { rpc, rpcBody } from "./helpers/mcp";
import { TEST_SITE_POSITION } from "./helpers/test-org";
import { createApiOrderReadFixture, removeApiOrderReadFixture, readParams, readRequest, READ_ARCHIVE_AT, READ_TIMEOUT_MS, UNKNOWN_READ_ID } from "./helpers/api-order-read-fixture";

type Fixture = Awaited<ReturnType<typeof fixture>>;
let a: Fixture;
let b: Fixture;
async function fixture() {
  const f = await createApiOrderReadFixture();
  const [supplier] = await db.insert(suppliers).values({ organizationId: f.ctx.organizationId, code: `E2E-S-${f.tag}`, name: `E2E Source ${f.tag}` }).returning();
  const [supplierLocation] = await db.insert(supplierLocations).values({ ...TEST_SITE_POSITION, country: "TZ", organizationId: f.ctx.organizationId, supplierId: supplier.id }).returning();
  const key = (await createApiKey(f.ctx, { name: "Location reads", scopes: ["customers:read", "suppliers:read"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key;
  return { ...f, supplier, supplierLocation, key };
}
beforeEach(async () => { a = await fixture(); b = await fixture(); }, READ_TIMEOUT_MS);
afterEach(async () => {
  for (const f of [a, b]) {
    await db.delete(supplierLocations).where(eq(supplierLocations.id, f.supplierLocation.id));
    await db.delete(suppliers).where(eq(suppliers.id, f.supplier.id));
    await removeApiOrderReadFixture(f);
  }
}, READ_TIMEOUT_MS);
const detail = (kind: "customer" | "supplier", parent: string, child: string, key = a.key, query = "") =>
  (kind === "customer" ? CUSTOMER : SUPPLIER)(readRequest(`/${kind}s/${parent}/locations/${child}${query}`, key), { params: Promise.resolve({ idOrCode: parent, locationId: child }) });
const list = (query = "") => LIST(readRequest(`/customers/${a.customer.id}/locations${query}`, a.key), readParams(a.customer.id));
const ids = (page: { data: { id: string }[] }) => page.data.map(row => row.id);

for (const kind of ["customer", "supplier"] as const) describe(`${kind} location details`, { timeout: READ_TIMEOUT_MS }, () => {
  const target = () => kind === "customer" ? { parent: a.customer.id, child: a.location } : { parent: a.supplier.id, child: a.supplierLocation };
  it("returns the API body and a strong ETag, including uppercase UUID paths", async () => {
    const { parent, child } = target();
    for (const upper of [false, true]) {
      const response = await detail(kind, upper ? parent.toUpperCase() : parent, upper ? child.id.toUpperCase() : child.id);
      expect(response.status).toBe(200);
      expect(response.headers.get("etag")).toBe(`"${child.version}.1"`);
      const { data } = await response.json();
      expect((kind === "customer" ? customerLocationRepresentationSchema : supplierLocationRepresentationSchema).parse(data)).toEqual(data);
      expect(data).toMatchObject({ id: child.id, [`${kind}Id`]: parent });
      expect(data).not.toHaveProperty("address");
    }
    if (kind === "customer") expect((await detail(kind, a.customer.code, child.id)).status).toBe(200);
    else await lookupProblem(await detail(kind, a.supplier.code, child.id), 404, "not_found");
  });
  it("hides missing, foreign and wrong-parent locations at /locationId", async () => {
    const { parent, child } = target();
    for (const [parentId, locationId, key] of [[parent, UNKNOWN_READ_ID, a.key], [UNKNOWN_READ_ID, child.id, a.key], [parent, child.id, b.key],
      [kind === "customer" ? a.otherCustomer.id : b.supplier.id, child.id, a.key]]) {
      const response = await detail(kind, parentId, locationId, key);
      await lookupProblem(response.clone(), 404, "not_found");
      expect((await response.json()).errors).toContainEqual(expect.objectContaining({ pointer: "/locationId" }));
    }
  });
  it("keeps the body and ETag stable when a paired facility is archived or restored", async () => {
    const { parent, child } = target();
    const pair = { organizationId: a.ctx.organizationId, locationId: child.id, facilityId: a.facility.id, distanceKm: 12, distanceSource: "manual" as const };
    if (kind === "customer") await db.insert(customerLocationFacilityDistances).values(pair);
    else await db.insert(supplierLocationFacilityDistances).values(pair);
    const first = await detail(kind, parent, child.id);
    const body = await first.json();
    expect(body.data.facilityDistances).toEqual([{ facilityId: a.facility.id, distanceKm: 12, distanceSource: "manual" }]);
    for (const archivedAt of [READ_ARCHIVE_AT, null]) {
      await db.update(facilities).set({ archivedAt }).where(eq(facilities.id, a.facility.id));
      const response = await detail(kind, parent, child.id);
      expect(response.status).toBe(200);
      expect(response.headers.get("etag")).toBe(first.headers.get("etag"));
      expect(await response.json()).toEqual(body);
    }
  });
  it("keeps details readable under archived parents and enforces read scope", async () => {
    const { parent, child } = target();
    if (kind === "customer") await db.update(customers).set({ archivedAt: READ_ARCHIVE_AT }).where(eq(customers.id, parent));
    else await db.update(suppliers).set({ archivedAt: READ_ARCHIVE_AT }).where(eq(suppliers.id, parent));
    expect((await detail(kind, parent, child.id)).status).toBe(200);
    await lookupProblem(await detail(kind, parent, child.id, a.writeOnlyKey), 403, "missing_scope");
    await lookupProblem(await detail(kind, parent, child.id, a.key, "?unknown=true"), 400, "invalid_query");
  });
});

describe("archived customer destination discovery", { timeout: READ_TIMEOUT_MS }, () => {
  it("selects active or archived sets, binds cursors in both directions and matches MCP", async () => {
    const [active, archived, otherArchived] = await db.insert(customerLocations).values([
      { ...TEST_SITE_POSITION, country: "TZ", organizationId: a.ctx.organizationId, customerId: a.customer.id, name: "E2E Active" },
      { ...TEST_SITE_POSITION, country: "TZ", organizationId: a.ctx.organizationId, customerId: a.customer.id, name: "E2E Archived", archivedAt: READ_ARCHIVE_AT },
      { ...TEST_SITE_POSITION, country: "TZ", organizationId: a.ctx.organizationId, customerId: a.customer.id, name: "E2E Archived two", archivedAt: READ_ARCHIVE_AT },
    ]).returning();
    expect(ids(await (await list()).json()).sort()).toEqual([a.location.id, active.id].sort());
    for (const archivedFilter of [false, true]) {
      const query = `?archived=${archivedFilter}`;
      const rest = await (await list(query)).json();
      expect(ids(rest).sort()).toEqual((archivedFilter ? [archived.id, otherArchived.id] : [a.location.id, active.id]).sort());
      const mcp = await rpcBody(await MCP(rpc(a.key, "tools/call", { name: "find_customer_locations", arguments: { idOrCode: a.customer.id.toUpperCase(), archived: archivedFilter } })));
      expect(mcp.result.structuredContent).toEqual(rest);
      const first = await (await list(`${query}&limit=1`)).json();
      expect(first.nextCursor).toEqual(expect.any(String));
      const next = await (await list(`${query}&cursor=${first.nextCursor}`)).json();
      expect(new Set([...ids(first), ...ids(next)])).toEqual(new Set(ids(rest)));
      await lookupProblem(await list(`?archived=${!archivedFilter}&cursor=${first.nextCursor}`), 400, "invalid_cursor");
      const mismatch = await rpcBody(await MCP(rpc(a.key, "tools/call", { name: "find_customer_locations", arguments: { idOrCode: a.customer.id, archived: !archivedFilter, cursor: first.nextCursor } })));
      expect(mismatch.result).toMatchObject({ isError: true, structuredContent: { code: "invalid_cursor" } });
    }
    const response = await detail("customer", a.customer.id, archived.id);
    expect(response.status).toBe(200);
    expect((await response.json()).data.archivedAt).toBe(READ_ARCHIVE_AT.toISOString());
  });
});
