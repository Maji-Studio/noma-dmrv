import { customerLocationFacilityDistances } from "@/db/schema";
import { TEST_SITE_POSITION } from "./helpers/test-org";
/** Real handlers, credentials and Postgres. Not run by the implementation agent. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customerLocations, customers } from "@/db/schema";
import { GET as LIST } from "@/app/api/v1/customers/route";
import { GET } from "@/app/api/v1/customers/[idOrCode]/route";
import { GET as LOCATIONS } from "@/app/api/v1/customers/[idOrCode]/locations/route";
import { customerRepresentationSchema } from "@/lib/representations/customers";
import { customerLocationRepresentationSchema } from "@/lib/representations/customer-locations";
import { lookupProblem } from "./helpers/api-lookups";
import { createApiOrderReadFixture, readParams, readRequest, removeApiOrderReadFixture,
  READ_TIMEOUT_MS, UNKNOWN_READ_ID, type ApiOrderReadFixture } from "./helpers/api-order-read-fixture";

const PAGE_LIMIT = 1;
let a: ApiOrderReadFixture;
let b: ApiOrderReadFixture;
let extra: typeof a.location;
const list = (query = "", key = a.key) => LIST(readRequest(`/customers${query}`, key));
const get = (identifier: string, key = a.key, query = "") => GET(readRequest(`/customers/${encodeURIComponent(identifier)}${query}`, key), readParams(identifier));
const locations = (identifier: string, query = "", key = a.key) => LOCATIONS(readRequest(`/customers/${encodeURIComponent(identifier)}/locations${query}`, key), readParams(identifier));
const ids = async (response: Response): Promise<string[]> => (await response.json()).data.map((row: { id: string }) => row.id);

beforeEach(async () => {
  a = await createApiOrderReadFixture(); b = await createApiOrderReadFixture();
  await db.update(customers).set({ contactEmail: "hidden@example.test", contactPhone: "hidden", address: "hidden", cropType: "hidden", createdAt: sql`'2026-10-01 12:00:00.123455'::timestamp` })
    .where(and(eq(customers.organizationId, a.ctx.organizationId), eq(customers.id, a.customer.id)));
  await db.update(customers).set({ createdAt: sql`'2026-10-01 12:00:00.123456'::timestamp` })
    .where(and(eq(customers.organizationId, a.ctx.organizationId), eq(customers.id, a.otherCustomer.id)));
  await db.insert(customerLocationFacilityDistances).values({ organizationId: a.ctx.organizationId, locationId: a.location.id, facilityId: a.facility.id, distanceKm: 20, distanceSource: "document" });
  await db.update(customerLocations).set({ createdAt: sql`'2026-10-01 12:00:00.123455'::timestamp`, gpsLatitude: 0, gpsLongitude: 8.5, isDefault: true, address: "hidden", defaultSoilTemperatureC: 25 })
    .where(and(eq(customerLocations.organizationId, a.ctx.organizationId), eq(customerLocations.id, a.location.id)));
  [extra] = await db.insert(customerLocations).values({ ...TEST_SITE_POSITION, organizationId: a.ctx.organizationId, customerId: a.customer.id, name: `E2E Field ${a.tag}`, createdAt: sql`'2026-10-01 12:00:00.123456'::timestamp` }).returning();
}, READ_TIMEOUT_MS);
afterEach(async () => { await removeApiOrderReadFixture(a); await removeApiOrderReadFixture(b); }, READ_TIMEOUT_MS);

describe("customer and destination REST reads", { timeout: READ_TIMEOUT_MS }, () => {
  it("returns the exact no-contact customer shape by UUID or code with a strong ETag", async () => {
    for (const identifier of [a.customer.id, a.customer.id.toUpperCase(), a.customer.code]) {
      const response = await get(identifier);
      expect(response.status).toBe(200);
      expect(response.headers.get("etag")).toBe(`"${a.customer.version}.2"`);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const { data } = await response.json();
      expect(customerRepresentationSchema.parse(data)).toEqual(data);
      expect(Object.keys(data).sort()).toEqual(["id", "code", "name", "version", "createdAt", "updatedAt", "cropType", "archivedAt"].sort());
      expect(data).toMatchObject({ id: a.customer.id, code: a.customer.code, name: a.customer.name, cropType: "hidden", archivedAt: null });
    }
  });

  it("paginates customers at microsecond precision with UUID tie-breaking, code and literal name/code searches", async () => {
    const [tie] = await db.insert(customers).values({ organizationId: a.ctx.organizationId, code: `CU-TIE-${a.tag}`, name: `E2E Tie ${a.tag}`, createdAt: sql`'2026-10-01 12:00:00.123456'::timestamp` }).returning();
    const expected = [...[a.otherCustomer.id, tie.id].sort().reverse(), a.customer.id];
    expect(await ids(await list())).toEqual(expected);
    const first = await (await list(`?limit=${PAGE_LIMIT}`)).json();
    expect(first).not.toHaveProperty("total");
    const seen = first.data.map((row: { id: string }) => row.id);
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await (await list(`?limit=${PAGE_LIMIT}&cursor=${cursor}`)).json();
      seen.push(...page.data.map((row: { id: string }) => row.id)); cursor = page.nextCursor;
    }
    expect(seen).toEqual(expected);
    expect(await ids(await list(`?code=${a.customer.code}`))).toEqual([a.customer.id]);
    expect(await ids(await list(`?q=${encodeURIComponent(a.customer.name.toLowerCase())}`))).toEqual([a.customer.id]);
    expect(await ids(await list(`?q=${a.customer.code.toLowerCase()}`))).toEqual([a.customer.id]);
    expect(await ids(await list("?q=%25"))).toEqual([]);
    await lookupProblem(await list(`?q=changed&cursor=${first.nextCursor}`), 400, "invalid_cursor");
    await lookupProblem(await list(`?cursor=${first.nextCursor}`, b.key), 400, "invalid_cursor");
  });

  it("lists GPS destinations and one-way distance without address or soil temperature by parent UUID or code", async () => {
    for (const identifier of [a.customer.id, a.customer.id.toUpperCase(), a.customer.code]) {
      const response = await locations(identifier);
      expect(response.status).toBe(200);
      const page = await response.json();
      expect(page.data.map((row: { id: string }) => row.id)).toEqual([extra.id, a.location.id]);
      for (const row of page.data) {
        expect(customerLocationRepresentationSchema.parse(row)).toEqual(row);
        expect(Object.keys(row).sort()).toEqual(Object.keys(customerLocationRepresentationSchema.shape).sort());
      }
      expect(page.data[1]).toMatchObject({ customerId: a.customer.id, gpsLatitude: 0, gpsLongitude: 8.5, facilityDistances: [{ facilityId: a.facility.id, distanceKm: 20, distanceSource: "document" }], isDefault: true, siteDescription: "hidden", defaultSoilTemperatureC: 25, country: expect.any(String), stateRegion: null, city: null });
      expect(page.data[0]).toMatchObject({ gpsLatitude: TEST_SITE_POSITION.gpsLatitude, gpsLongitude: TEST_SITE_POSITION.gpsLongitude, facilityDistances: [], isDefault: false });
    }
    expect(await ids(await locations(a.otherCustomer.id))).toEqual([]);
  });

  it("binds location cursors to the canonical parent, org, resource and filters", async () => {
    const page = await (await locations(a.customer.code, `?limit=${PAGE_LIMIT}`)).json();
    expect(page.data.map((row: { id: string }) => row.id)).toEqual([extra.id]);
    expect(await ids(await locations(a.customer.id.toUpperCase(), `?cursor=${page.nextCursor}`))).toEqual([a.location.id]);
    expect(await ids(await locations(a.customer.id, "?q=e2e%20field"))).toEqual([extra.id]);
    await lookupProblem(await locations(a.otherCustomer.id, `?cursor=${page.nextCursor}`), 400, "invalid_cursor");
    await lookupProblem(await locations(a.customer.id, `?q=changed&cursor=${page.nextCursor}`), 400, "invalid_cursor");
    await lookupProblem(await list(`?cursor=${page.nextCursor}`), 400, "invalid_cursor");
  });

  it("returns 404 for foreign/unknown parents and paths, and 403 before any lookup without scope", async () => {
    for (const identifier of [a.customer.id, a.customer.id.toUpperCase(), a.customer.code, UNKNOWN_READ_ID, "missing"]) {
      await lookupProblem(await get(identifier, b.key), 404, "not_found");
      await lookupProblem(await locations(identifier, "", b.key), 404, "not_found");
    }
    expect(await ids(await list(`?code=${a.customer.code}`, b.key))).toEqual([]);
    for (const key of [a.missingScopeKey, a.orderKey, a.writeOnlyKey]) {
      await lookupProblem(await list("", key), 403, "missing_scope");
      for (const identifier of [a.customer.id, b.customer.id, "missing"]) {
        await lookupProblem(await get(identifier, key), 403, "missing_scope");
        await lookupProblem(await locations(identifier, "", key), 403, "missing_scope");
      }
    }
    expect((await list("", a.customerKey)).status).toBe(200);
    for (const query of ["?unknown=1", "?q=a&q=b", "?limit=0"]) {
      await lookupProblem(await list(query), 400, "invalid_query");
      await lookupProblem(await locations(a.customer.id, query), 400, "invalid_query");
    }
    await lookupProblem(await get(a.customer.id, a.key, "?q=x"), 400, "invalid_query");
  });
});
