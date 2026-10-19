/** Real handlers, credentials and Postgres. Not run by the implementation agent. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { storageLocations } from "@/db/schema";
import { GET as LIST } from "@/app/api/v1/storage-locations/route";
import { GET } from "@/app/api/v1/storage-locations/[idOrCode]/route";
import { makeBiocharProduct } from "@/lib/operations/biochar-products";
import { runOperation } from "@/lib/operations/runner";
import { STORAGE_LOCATION_REPRESENTATION_REVISION } from "@/config/api-rest";
import { storageLocationRepresentationSchema } from "@/lib/representations/storage-locations";
import { lookupProblem } from "./helpers/api-lookups";
import { createApiOrderReadFixture, readParams, readRequest, removeApiOrderReadFixture,
  READ_TIMEOUT_MS, UNKNOWN_READ_ID, type ApiOrderReadFixture } from "./helpers/api-order-read-fixture";

let a: ApiOrderReadFixture;
let b: ApiOrderReadFixture;
let unclaimed: typeof a.bin;
const list = (query = "", key = a.key) => LIST(readRequest(`/storage-locations${query}`, key));
const get = (id: string, key = a.key) => GET(readRequest(`/storage-locations/${id}`, key), readParams(id));
const ids = async (response: Response): Promise<string[]> => (await response.json()).data.map((row: { id: string }) => row.id);

beforeEach(async () => {
  a = await createApiOrderReadFixture(); b = await createApiOrderReadFixture();
  [unclaimed] = await db.insert(storageLocations).values({ organizationId: a.ctx.organizationId, facilityId: a.facility.id,
    code: `E2E-UNCLAIMED-${a.tag}`, name: `E2E Unclaimed ${a.tag}`, type: "product_bin" }).returning();
}, READ_TIMEOUT_MS);
afterEach(async () => { await removeApiOrderReadFixture(a); await removeApiOrderReadFixture(b); }, READ_TIMEOUT_MS);

describe("storage location formulation discovery", { timeout: READ_TIMEOUT_MS }, () => {
  it("publishes formulationId for a claimed product bin and null elsewhere, at revision 3", async () => {
    for (const [row, formulationId] of [[a.bin, a.recipe.id], [a.source, null], [unclaimed, null]] as const) {
      const response = await get(row.id);
      expect(response.status).toBe(200);
      expect(response.headers.get("etag")).toBe(`"${row.version}.${STORAGE_LOCATION_REPRESENTATION_REVISION}"`);
      const { data } = await response.json();
      expect(storageLocationRepresentationSchema.parse(data)).toEqual(data);
      expect(data.formulationId).toBe(formulationId);
    }
    const feedstock = await (await list("?type=feedstock_bin")).json();
    expect(feedstock.data.length).toBeGreaterThan(0);
    expect(feedstock.data.every((row: { formulationId: string | null }) => row.formulationId === null)).toBe(true);
  });

  it("filters by lane and canonical formulation UUID and binds filters in the cursor", async () => {
    expect(await ids(await list("?type=product_bin"))).toEqual(expect.arrayContaining([a.bin.id, unclaimed.id]));
    expect(await ids(await list("?type=biochar_bin"))).toEqual([a.source.id]);
    expect(await ids(await list(`?formulationId=${a.recipe.id.toUpperCase()}`))).toEqual([a.bin.id]);
    expect(await ids(await list(`?type=product_bin&formulationId=${a.recipe.id}&facilityId=${a.facility.id}`))).toEqual([a.bin.id]);
    expect(await ids(await list(`?type=biochar_bin&formulationId=${a.recipe.id}`))).toEqual([]);
    const page = await (await list("?type=product_bin&limit=1")).json();
    expect(page.nextCursor).toBeTruthy();
    await lookupProblem(await list(`?type=biochar_bin&cursor=${page.nextCursor}`), 400, "invalid_cursor");
    await lookupProblem(await list(`?type=product_bin&formulationId=${a.recipe.id}&cursor=${page.nextCursor}`), 400, "invalid_cursor");
  });

  it("refuses foreign/unknown formulation filters and paths, and checks scope before lookup", async () => {
    for (const formulationId of [b.recipe.id, b.recipe.id.toUpperCase(), UNKNOWN_READ_ID]) {
      const problem = await lookupProblem(await list(`?formulationId=${formulationId}`), 404, "not_found");
      expect(problem.errors[0].pointer).toBe("/formulationId");
      await lookupProblem(await list(`?formulationId=${formulationId}`, a.writeOnlyKey), 403, "missing_scope");
    }
    for (const id of [b.bin.id, UNKNOWN_READ_ID]) await lookupProblem(await get(id), 404, "not_found");
  });

  it("changes the ETag on an actual product writer's formulation claim", async () => {
    const before = await get(unclaimed.id);
    expect((await before.json()).data.formulationId).toBeNull();
    await runOperation(makeBiocharProduct, a.ctx, {
      facilityId: a.facility.id, formulationId: a.pure.id, sourceBiocharStorageLocationId: a.source.id,
      storageLocationId: unclaimed.id, placedAt: "2026-09-12T12:00:00Z", biocharWetMassKg: 100,
      biocharMoisturePercent: 10, waterAddedKg: 0,
    });
    const after = await get(unclaimed.id);
    expect(after.status).toBe(200);
    expect(after.headers.get("etag")).not.toBe(before.headers.get("etag"));
    expect((await after.json()).data).toMatchObject({ formulationId: a.pure.id, version: unclaimed.version + 1 });
    const [stored] = await db.select().from(storageLocations).where(and(eq(storageLocations.organizationId, a.ctx.organizationId), eq(storageLocations.id, unclaimed.id)));
    expect(stored.version).toBe(unclaimed.version + 1);
  });
});
