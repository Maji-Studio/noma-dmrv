/** Real handlers, credentials and Postgres, using the worktree test database. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities, productionRuns, storageLocations } from "@/db/schema";
import { GET } from "@/app/api/v1/storage-locations/[idOrCode]/stock/route";
import { POST as MCP } from "@/app/api/mcp/route";
import { OUTPUT_BIN_STOCK_REPRESENTATION_REVISION } from "@/config/api-rest";
import { bodyHashEtag } from "@/lib/api/etag";
import { outputBinStockRepresentationSchema } from "@/lib/representations/output-bin-stock";
import { UNRESOLVED_STOCK_SENTENCES } from "@/lib/output-stock/layer-projection";
import {
  createApiProductFixture, FIRST_LOSS_AT, FIRST_LOSS_WET_KG, makePureProduct, postLoss,
  productApiParams, productApiRequest, removeApiProductFixture, type ApiProductFixture,
} from "./helpers/api-biochar-product-fixture";
import { rpc, rpcBody } from "./helpers/mcp";

const TIMEOUT_MS = 60_000;
const ARCHIVED_AT = "2026-10-01T00:00:00.000Z";
const INITIAL_DRY_KG = 1500;
const INITIAL_WET_KG = 1750;
let a: ApiProductFixture;
let b: ApiProductFixture;
const stock = (idOrCode: string, query = "", key = a.key) =>
  GET(productApiRequest(`/storage-locations/${encodeURIComponent(idOrCode)}/stock${query}`, key), productApiParams(idOrCode));
const call = async (storageLocation: string, key = a.key, input: Record<string, unknown> = {}) => {
  const response = await MCP(rpc(key, "tools/call", { name: "get_bin_stock", arguments: { storageLocation, ...input } }));
  expect(response.status).toBe(200);
  return (await rpcBody(response)).result;
};
async function problem(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-type")).toContain("application/problem+json");
  const body = await response.json();
  expect(body.code).toBe(code);
  return body;
}

beforeEach(async () => {
  a = await createApiProductFixture();
  b = await createApiProductFixture();
}, TIMEOUT_MS);
afterEach(async () => { await removeApiProductFixture(a); await removeApiProductFixture(b); }, TIMEOUT_MS);

describe("output bin stock REST and MCP", { timeout: TIMEOUT_MS }, () => {
  it("publishes held layers, exact data ETags and identical bytes across unchanged reads", async () => {
    const first = await stock(a.source.id);
    const second = await stock(a.source.code);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    const text = await first.text();
    expect(await second.text()).toBe(text);
    const body = JSON.parse(text);
    expect(outputBinStockRepresentationSchema.parse(body.data)).toEqual(body.data);
    expect(body).toEqual({ data: expect.objectContaining({ storageLocationId: a.source.id, code: a.source.code, facilityId: a.facility.id,
      type: "biochar_bin", archivedAt: null, formulationId: null, stockMode: "split", status: "resolved", unresolvedReason: null,
      totals: expect.objectContaining({ dryBiocharKg: INITIAL_DRY_KG, solidsKg: INITIAL_DRY_KG, estimatedWetKg: INITIAL_WET_KG }) }) });
    expect(body.data.subBins.map((layer: { layerId: string }) => layer.layerId)).toEqual([a.r1, a.r2]);
    expect(body.data.subBins.map((layer: { code: string }) => layer.code)).toEqual(a.runs.map((run) => run.code));
    expect(first.headers.get("etag")).toBe(bodyHashEtag(OUTPUT_BIN_STOCK_REPRESENTATION_REVISION, body.data));
    expect(second.headers.get("etag")).toBe(first.headers.get("etag"));
    for (const field of ["at", "evaluatedAt", "allLayersDryKg", "organizationId", "recentMovements"]) expect(body.data).not.toHaveProperty(field);
    await postLoss(a, FIRST_LOSS_AT, FIRST_LOSS_WET_KG);
    const after = await stock(a.source.id);
    expect(after.status).toBe(200);
    expect(after.headers.get("etag")).not.toBe(first.headers.get("etag"));
    expect((await after.json()).data.totals.dryBiocharKg).toBeLessThan(INITIAL_DRY_KG);
  });

  it("returns REST bodies unchanged through MCP for biochar, product and empty bins", async () => {
    await makePureProduct(a);
    for (const identifier of [a.source.id, a.source.code, a.pureBin.id, a.bin.id]) {
      const rest = await stock(identifier);
      expect(rest.status).toBe(200);
      const body = await rest.json();
      const result = await call(identifier, a.key, { facilityId: a.facility.id });
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual(body);
      expect(result.content).toEqual([{ type: "text", text: `Bin ${body.data.code} stock read.` }]);
    }
    expect((await (await stock(a.pureBin.id)).json()).data).toMatchObject({ type: "product_bin", formulationId: a.pure.id,
      subBins: [expect.objectContaining({ layerKind: "biochar_product" })] });
    expect((await (await stock(a.bin.id)).json()).data).toMatchObject({ status: "resolved", subBins: [],
      totals: { dryBiocharKg: 0, solidsKg: 0, estimatedWetKg: 0, estimatedMoisturePercent: null, moistureBasis: null } });
  });

  it("keeps archived bins and their archived layers readable", async () => {
    await db.update(storageLocations).set({ archivedAt: new Date(ARCHIVED_AT) })
      .where(and(eq(storageLocations.id, a.source.id), eq(storageLocations.organizationId, a.ctx.organizationId)));
    await db.update(productionRuns).set({ archivedAt: new Date(ARCHIVED_AT) })
      .where(and(eq(productionRuns.id, a.r1), eq(productionRuns.organizationId, a.ctx.organizationId)));
    const response = await stock(a.source.id);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ archivedAt: ARCHIVED_AT, totals: { dryBiocharKg: INITIAL_DRY_KG } });
  });

  it("returns unresolved stock as 200 with a stable ETag and the same MCP body", async () => {
    await db.update(productionRuns).set({ biocharDryMassKg: null })
      .where(and(eq(productionRuns.id, a.r1), eq(productionRuns.organizationId, a.ctx.organizationId)));
    const response = await stock(a.source.id);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({ status: "unresolved", unresolvedReason: UNRESOLVED_STOCK_SENTENCES.run_incomplete, totals: null, subBins: [] });
    expect((await stock(a.source.id)).headers.get("etag")).toBe(response.headers.get("etag"));
    expect((await call(a.source.id)).structuredContent).toEqual(body);
  });

  it("hides foreign and unknown bins with 404 and matching MCP errors", async () => {
    for (const identifier of [b.source.id, b.source.code, b.pureBin.id, randomUUID(), "missing"]) {
      const rest = await problem(await stock(identifier), 404, "not_found");
      const result = await call(identifier);
      expect(result).toMatchObject({ isError: true, structuredContent: {
        code: rest.code, detail: rest.detail, retryable: rest.retryable, issues: rest.errors,
      } });
      for (const field of ["status", "instance", "requestId"]) expect(result.structuredContent).not.toHaveProperty(field);
    }
  });

  it("refuses a feedstock bin with 422 and matching MCP issue shapes", async () => {
    const rest = await problem(await stock(a.ingredientBin.id), 422, "validation_failed");
    expect(rest.errors[0].pointer).toBe("/storageLocationId");
    expect(await call(a.ingredientBin.id)).toMatchObject({ isError: true, structuredContent: {
      code: rest.code, detail: rest.detail, retryable: rest.retryable, issues: rest.errors,
    } });
  });

  it("requires the products read scope and lists the tool only with that scope", async () => {
    for (const key of [a.key, a.otherScopeKey, a.formulationsOnlyKey]) {
      const listed = (await rpcBody(await MCP(rpc(key, "tools/list")))).result.tools;
      expect(listed.some((tool: { name: string }) => tool.name === "get_bin_stock")).toBe(key === a.key);
      if (key !== a.key) await problem(await stock(a.source.id, "", key), 403, "missing_scope");
    }
  });

  it("refuses unknown and repeated query keys, malformed facility ids and facility mismatches", async () => {
    for (const query of ["?at=2026-09-01", "?q=x", "?limit=1", "?facilityId=bad", `?facilityId=${a.facility.id}&facilityId=${a.facility.id}`]) {
      await problem(await stock(a.source.id, query), 400, "invalid_query");
    }
    const [otherFacility] = await db.insert(facilities).values({ organizationId: a.ctx.organizationId,
      code: `E2E-STOCK-F-${a.tag}`, name: `E2E Stock facility ${a.tag}`, timezone: "UTC" }).returning();
    for (const facilityId of [otherFacility.id, b.facility.id, randomUUID()]) {
      await problem(await stock(a.source.id, `?facilityId=${facilityId}`), 404, "not_found");
      expect(await call(a.source.id, a.key, { facilityId })).toMatchObject({ isError: true, structuredContent: { code: "not_found" } });
    }
    expect((await stock(a.source.id, `?facilityId=${a.facility.id.toUpperCase()}`)).status).toBe(200);
    expect(await call(a.source.id, a.key, { at: ARCHIVED_AT })).toMatchObject({ isError: true, structuredContent: { code: "invalid_query" } });
  });
});
