/** Real handlers and Postgres. Written for reviewer execution; never run by the implementation agent. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { facilities, storageLocations, supplierLocations, suppliers } from "@/db/schema";
import { GET as STORAGE_LIST } from "@/app/api/v1/storage-locations/route";
import { GET as STORAGE_GET } from "@/app/api/v1/storage-locations/[idOrCode]/route";
import { GET as FACILITY_LIST } from "@/app/api/v1/facilities/route";
import { GET as LOCATION_LIST } from "@/app/api/v1/suppliers/[idOrCode]/locations/route";
import {
  createLookupFixture, removeLookupFixture, lookupParams, lookupProblem, lookupRequest,
  LOOKUP_SUITE_TIMEOUT_MS, type LookupFixture,
} from "./helpers/api-lookups";

const PAGE_LIMIT = 1;
let a: LookupFixture;
let b: LookupFixture;
beforeEach(async () => { a = await createLookupFixture(); b = await createLookupFixture(); });
afterEach(async () => { await removeLookupFixture(a); await removeLookupFixture(b); });
const storageRequest = (path: string, key = a.key) => lookupRequest("storage-locations", path, key);
const locationRequest = (supplierId: string, query = "", key = a.key) => lookupRequest("suppliers", `/${supplierId}/locations${query}`, key);

async function locations(supplierId: string, query = "", key = a.key) {
  return LOCATION_LIST(locationRequest(supplierId, query, key), lookupParams(supplierId));
}

describe("facility filters and owned supplier locations", { timeout: LOOKUP_SUITE_TIMEOUT_MS }, () => {
  it("narrows storage lists and id/code gets to an org-checked facility", async () => {
    const [secondFacility] = await db.insert(facilities).values({ organizationId: a.ctx.organizationId, code: "FAC-SECOND", name: "Second facility" }).returning();
    const bins = await db.insert(storageLocations).values([a.facilityId, secondFacility.id].map((facilityId, index) => ({
      organizationId: a.ctx.organizationId, facilityId, code: `LOOKUP-BIN-${index}`, name: `Lookup bin ${index}`, type: "feedstock_bin" as const,
    }))).returning();
    const query = `?q=lookup&facilityId=${a.facilityId}`;
    const list = await STORAGE_LIST(storageRequest(query));
    expect(list.status).toBe(200);
    expect((await list.json()).data.map((row: { id: string }) => row.id)).toEqual([bins[0].id]);
    for (const identifier of [bins[0].id, bins[0].code]) {
      const response = await STORAGE_GET(storageRequest(`/${identifier}?facilityId=${a.facilityId}`), lookupParams(identifier));
      expect(response.status).toBe(200);
      expect((await response.json()).data).toMatchObject({ id: bins[0].id, facilityId: a.facilityId });
      await lookupProblem(await STORAGE_GET(storageRequest(`/${identifier}?facilityId=${secondFacility.id}`), lookupParams(identifier)), 404, "not_found");
      const foreign = await lookupProblem(await STORAGE_GET(storageRequest(`/${identifier}?facilityId=${a.facilityId}`, b.key), lookupParams(identifier)), 404, "not_found");
      expect(foreign.errors).toEqual([{ pointer: "/facilityId", code: "not_found", detail: expect.any(String) }]);
    }
    const foreign = await lookupProblem(await STORAGE_LIST(storageRequest(`?facilityId=${a.facilityId}`, b.key)), 404, "not_found");
    expect(foreign.errors[0].pointer).toBe("/facilityId");
    await lookupProblem(await STORAGE_LIST(storageRequest("?facilityId=invalid")), 400, "invalid_query");
    await lookupProblem(await STORAGE_GET(storageRequest(`/${bins[0].id}?facilityId=invalid`), lookupParams(bins[0].id)), 400, "invalid_query");
    const page = await (await STORAGE_LIST(storageRequest(`?limit=${PAGE_LIMIT}`))).json();
    await lookupProblem(await STORAGE_LIST(storageRequest(`?facilityId=${a.facilityId}&cursor=${page.nextCursor}`)), 400, "invalid_cursor");
    await lookupProblem(await FACILITY_LIST(lookupRequest("facilities", `?cursor=${page.nextCursor}`, a.key)), 400, "invalid_cursor");
    await lookupProblem(await FACILITY_LIST(lookupRequest("facilities", `?facilityId=${a.facilityId}`, a.key)), 400, "invalid_query");
  });

  it("paginates only the supplier's owned locations, projecting names and coordinates", async () => {
    const [otherSupplier] = await db.insert(suppliers).values({ organizationId: a.ctx.organizationId, code: "SUP-OTHER", name: "Other supplier" }).returning();
    const owned = await db.insert(supplierLocations).values([
      { organizationId: a.ctx.organizationId, supplierId: a.supplierId, name: "Lookup orchard", gpsLatitude: 0, gpsLongitude: 32, address: "Hidden", createdAt: new Date("2026-10-08T12:00:00Z") },
      { organizationId: a.ctx.organizationId, supplierId: a.supplierId, name: "Lookup forest", gpsLatitude: null, gpsLongitude: null, createdAt: new Date("2026-10-08T12:00:01Z") },
      { organizationId: a.ctx.organizationId, supplierId: a.supplierId, name: "Literal %_\\ location", createdAt: new Date("2026-10-08T12:00:02Z") },
    ]).returning();
    await db.insert(supplierLocations).values({ organizationId: a.ctx.organizationId, supplierId: otherSupplier.id, name: "Lookup foreign parent" });
    const firstResponse = await locations(a.supplierId, `?q=lookup&limit=${PAGE_LIMIT}`);
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    expect(first.data.map((row: { id: string }) => row.id)).toEqual([owned[1].id]);
    expect(first.nextCursor).toBeTruthy();
    expect(first).not.toHaveProperty("total");
    const secondResponse = await locations(a.supplierId, `?q=lookup&limit=${PAGE_LIMIT}&cursor=${first.nextCursor}`);
    expect(secondResponse.status).toBe(200);
    const second = await secondResponse.json();
    expect(second.data).toHaveLength(1);
    expect(second.data[0]).toMatchObject({ id: owned[0].id, name: "Lookup orchard", gpsLatitude: 0, gpsLongitude: 32, version: 1, archivedAt: null });
    for (const field of ["address", "country", "organizationId", "code"]) expect(second.data[0]).not.toHaveProperty(field);
    expect(second.nextCursor).toBeNull();
    const literal = await (await locations(a.supplierId, `?q=${encodeURIComponent("literal %_\\")}`)).json();
    expect(literal.data.map((row: { id: string }) => row.id)).toEqual([owned[2].id]);
    await lookupProblem(await locations(otherSupplier.id, `?q=lookup&cursor=${first.nextCursor}`), 400, "invalid_cursor");
    await lookupProblem(await locations(a.supplierId, `?q=changed&cursor=${first.nextCursor}`), 400, "invalid_cursor");
    await lookupProblem(await locations(a.supplierId, `?q=lookup&cursor=${first.nextCursor}`, b.key), 400, "invalid_cursor");
    await lookupProblem(await locations(a.supplierId, "", b.key), 404, "not_found");
    await lookupProblem(await locations(a.supplierId, "", a.missingScopeKey), 403, "missing_scope");
    for (const query of ["?code=anything", `?facilityId=${a.facilityId}`, "?unknown=true", "?q=a&q=b", "?limit=0"]) {
      await lookupProblem(await locations(a.supplierId, query), 400, "invalid_query");
    }
    await lookupProblem(await locations("not-a-uuid"), 404, "not_found");
    expect((await (await locations(otherSupplier.id, "?q=missing")).json()).data).toEqual([]);
  });
});
