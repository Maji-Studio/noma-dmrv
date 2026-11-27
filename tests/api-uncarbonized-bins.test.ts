/** Real REST/MCP handlers, credentials and Postgres. For reviewer execution only. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as MCP } from "@/app/api/mcp/route";
import { GET as LIST } from "@/app/api/v1/storage-locations/route";
import { GET as GET_BIN } from "@/app/api/v1/storage-locations/[idOrCode]/route";
import { STORAGE_LOCATION_REPRESENTATION_REVISION } from "@/config/api-rest";
import { UNCARBONIZED_PRODUCT_SOURCE_MESSAGE } from "@/lib/storage-location-material";
import { storageLocationRepresentationSchema } from "@/lib/representations/storage-locations";
import { captureProductWriteState, postProductRest, productWriteAudits, pureProductBody, writeIdempotencyRecords } from "./helpers/api-biochar-write-fixture";
import { createApiProductFixture, expectProblem, productApiParams, productApiRequest, removeApiProductFixture, type ApiProductFixture } from "./helpers/api-biochar-product-fixture";
import { rpc, rpcBody } from "./helpers/mcp";

const TIMEOUT_MS = 60_000;
let f: ApiProductFixture;
beforeEach(async () => { f = await createApiProductFixture({ uncarbonized: true }); }, TIMEOUT_MS);
afterEach(async () => { await removeApiProductFixture(f); }, TIMEOUT_MS);

async function call(name: string, args: Record<string, unknown>) {
  const response = await MCP(rpc(f.writeKey, "tools/call", { name, arguments: args }));
  expect(response.status).toBe(200);
  return (await rpcBody(response)).result;
}
async function unchanged() {
  const state = await captureProductWriteState(f);
  expect(state.products).toEqual([]);
  expect(state.movements).toEqual([]);
  expect(await productWriteAudits(f)).toEqual([]);
  expect(await writeIdempotencyRecords(f)).toEqual([]);
}

describe("uncarbonized bins on REST and MCP", { timeout: TIMEOUT_MS }, () => {
  it.each([false, true])("refuses REST product draw, dryRun=%s, and commits nothing", async dryRun => {
    const response = await postProductRest(f, pureProductBody(f), randomUUID(), dryRun ? "?dryRun=true" : "");
    const problem = await expectProblem(response, 422, "validation_failed");
    expect(problem.errors).toContainEqual(expect.objectContaining({ pointer: "/sourceBiocharStorageLocationId", detail: UNCARBONIZED_PRODUCT_SOURCE_MESSAGE }));
    await unchanged();
  });

  it.each([false, true])("refuses MCP product draw, dryRun=%s, through the same field guard", async dryRun => {
    const result = await call("make_biochar_product", { ...pureProductBody(f), requestKey: randomUUID(), dryRun });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "validation_failed", issues: expect.arrayContaining([expect.objectContaining({
      pointer: "/sourceBiocharStorageLocationId",
    })]) });
    await unchanged();
  });

  it("publishes revision 5 and filters both REST tag values", async () => {
    for (const uncarbonized of [true, false]) {
      const response = await LIST(productApiRequest(`/storage-locations?facilityId=${f.facility.id}&uncarbonized=${uncarbonized}`, f.key));
      expect(response.status).toBe(200);
      const { data } = await response.json();
      expect(data.length).toBeGreaterThan(0);
      for (const row of data) {
        expect(storageLocationRepresentationSchema.parse(row).uncarbonized).toBe(uncarbonized);
      }
      expect(data.some((row: { id: string }) => row.id === f.source.id)).toBe(uncarbonized);
    }
    const response = await GET_BIN(productApiRequest(`/storage-locations/${f.source.id}`, f.key), productApiParams(f.source.id));
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(`"1.${STORAGE_LOCATION_REPRESENTATION_REVISION}"`);
    expect((await response.json()).data.uncarbonized).toBe(true);
    await expectProblem(await LIST(productApiRequest("/storage-locations?uncarbonized=yes", f.key)), 400, "invalid_query");
  });

  it("filters both MCP tag values and binds REST cursors to the tag", async () => {
    for (const uncarbonized of [true, false]) {
      const result = await call("find_storage_locations", { facilityId: f.facility.id, uncarbonized });
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent.data.length).toBeGreaterThan(0);
      expect(result.structuredContent.data.every((row: { uncarbonized: boolean }) => row.uncarbonized === uncarbonized)).toBe(true);
    }
    const first = await LIST(productApiRequest(`/storage-locations?uncarbonized=false&limit=1`, f.key));
    expect(first.status).toBe(200);
    const page = await first.json();
    expect(page.nextCursor).toEqual(expect.any(String));
    const changed = await LIST(productApiRequest(`/storage-locations?uncarbonized=true&limit=1&cursor=${encodeURIComponent(page.nextCursor)}`, f.key));
    await expectProblem(changed, 400, "invalid_cursor");
  });
});
