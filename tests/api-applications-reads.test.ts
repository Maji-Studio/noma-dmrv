import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/v1/applications/[idOrCode]/route";
import { GET as LIST } from "@/app/api/v1/applications/route";
import { GET as BOUNDARY } from "@/app/api/v1/applications/[idOrCode]/boundary/route";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { applicationOutputAllocations, biocharProducts, binMovements, creditBatchApplications, creditBatchProductionRuns, creditBatches, deliveries, feedstocks, outputStockAllocations, productionProcesses } from "@/db/schema";
import { getMixBinHeldApplicationIds } from "@/data-access/mix-bin-credit-hold";
import { PRO_RATA_POLICY } from "@/lib/output-stock";
import { updateApplication } from "@/lib/operations/applications";
import { runOperationInProcess } from "@/lib/operations/runner";
import { lookupProblem } from "./helpers/api-lookups";
import { TEST_GIS_BOUNDARY } from "./helpers/application-evidence-fixtures";
import { applicationRepresentationSchema } from "@/lib/representations/applications";
import { addReadApplicationAllocation, createApiApplicationReadFixture, insertReadApplication, removeApiApplicationReadFixture, type ApiApplicationReadFixture } from "./helpers/api-application-read-fixture";
import { insertReadDelivery, insertReadOrder, readParams, readRequest, READ_TIMEOUT_MS, UNKNOWN_READ_ID } from "./helpers/api-order-read-fixture";

let a: ApiApplicationReadFixture;
const list = (query = "", key = a.applicationKey) => LIST(readRequest(`/applications${query}`, key));
const get = (id: string, key = a.applicationKey, etag?: string) => {
  const request = readRequest(`/applications/${id}`, key);
  if (etag) request.headers.set("If-None-Match", etag);
  return GET(request, readParams(id));
};
const boundary = (id: string, key = a.applicationKey, etag?: string) => {
  const request = readRequest(`/applications/${id}/boundary`, key);
  if (etag) request.headers.set("If-None-Match", etag);
  return BOUNDARY(request, readParams(id));
};
const ids = async (response: Response): Promise<string[]> => (await response.json()).data.map((r: { id: string }) => r.id);
beforeEach(async () => { a = await createApiApplicationReadFixture(); }, READ_TIMEOUT_MS);
afterEach(async () => { if (a) await removeApiApplicationReadFixture(a); }, READ_TIMEOUT_MS);
describe("application REST reads", { timeout: READ_TIMEOUT_MS }, () => {
  it("reads application owned facts by UUID and code with a version ETag", async () => {
    const row = await insertReadApplication(a);
    for (const id of [row.id, row.code, row.id.toUpperCase()]) {
      const response = await GET(readRequest(`/applications/${id}`, a.applicationKey), readParams(id));
      expect(response.status).toBe(200);
      expect(response.headers.get("etag")).toBe('"1.1"');
      const { data } = await response.json();
      expect(applicationRepresentationSchema.parse(data)).toEqual(data);
      expect(data).toMatchObject({ id: row.id, applicationDate: "2026-09-15", appliedWetMassKg: 25, dryBiocharKg: 20, allocations: [] });
    }
  });

  it("pages with PostgreSQL microseconds and UUID ties and binds cursors to org and filters", async () => {
    const first = await insertReadApplication(a, { createdAt: sql`'2026-10-01 12:00:00.123455'::timestamp` });
    const second = await insertReadApplication(a, { createdAt: sql`'2026-10-01 12:00:00.123456'::timestamp` });
    const tied = await insertReadApplication(a, { createdAt: sql`'2026-10-01 12:00:00.123456'::timestamp` });
    const expected = [...[second.id, tied.id].sort().reverse(), first.id];
    expect(await ids(await list())).toEqual(expected);
    let cursor: string | null = null;
    const seen: string[] = [];
    do {
      const response = await list(`?limit=1${cursor ? `&cursor=${cursor}` : ""}`);
      const page = await response.json();
      expect(page).not.toHaveProperty("total");
      seen.push(...page.data.map((r: { id: string }) => r.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(expected);
    const page = await (await list("?limit=1")).json();
    await lookupProblem(await list(`?deliveryId=${a.delivery.id}&cursor=${page.nextCursor}`), 400, "invalid_cursor");
    const b = await createApiApplicationReadFixture();
    try { await lookupProblem(await list(`?cursor=${page.nextCursor}`, b.applicationKey), 400, "invalid_cursor"); }
    finally { await removeApiApplicationReadFixture(b); }
  });

  it("filters facilities, deliveries, orders, evidence, literal search and half open calendar bounds", async () => {
    const first = await insertReadApplication(a, { code: `AP-FIRST-${a.tag}`, fieldIdentifier: "North", cropType: "Maize", evidenceMethod: "visual" });
    const next = await insertReadApplication(a, { applicationDate: new Date("2026-09-16T00:00:00Z"), evidenceMethod: "boundary", gisBoundary: TEST_GIS_BOUNDARY });
    const otherOrder = await insertReadOrder(a, `OR-OTHER-${a.tag}`, { facilityId: a.otherFacility.id });
    const otherDelivery = await insertReadDelivery(a, otherOrder.id, 50);
    await db.update(deliveries).set({ facilityId: a.otherFacility.id }).where(eq(deliveries.id, otherDelivery.id));
    const other = await insertReadApplication(a, { deliveryId: otherDelivery.id, applicationDate: new Date("2026-09-14T00:00:00Z") });
    for (const [field, id] of [["facilityId", a.facility.id], ["deliveryId", a.delivery.id], ["orderId", a.order.id]]) {
      expect((await ids(await list(`?${field}=${id.toUpperCase()}`))).sort()).toEqual([first.id, next.id].sort());
    }
    expect(await ids(await list(`?code=${first.code}`))).toEqual([first.id]);
    for (const q of ["ap-first", "north", "maiz"]) expect(await ids(await list(`?q=${q}`))).toEqual([first.id]);
    expect(await ids(await list("?q=%25"))).toEqual([]);
    expect(await ids(await list("?evidenceMethod=visual"))).toEqual([first.id]);
    expect(await ids(await list("?evidenceMethod=boundary"))).toEqual([next.id]);
    expect(await ids(await list("?evidenceMethod=location"))).toEqual([other.id]);
    expect(await ids(await list("?appliedFrom=2026-09-15&appliedBefore=2026-09-16"))).toEqual([first.id]);
    expect(await ids(await list("?appliedFrom=2026-09-16"))).toEqual([next.id]);
    expect(await ids(await list("?appliedBefore=2026-09-15"))).toEqual([other.id]);
    for (const query of ["?unknown=1", "?appliedFrom=2026-02-29", "?appliedBefore=2026-01-01T00:00:00Z", "?limit=1&limit=2"]) await lookupProblem(await list(query), 400, "invalid_query");
  });

  it("matches credited and mix-bin held-out applications by their own shares, not other applications on the truck", async () => {
    const credited = await insertReadApplication(a);
    const heldOut = await insertReadApplication(a);
    const unrelated = await insertReadApplication(a);
    const [intake] = await db.select().from(feedstocks).where(eq(feedstocks.organizationId, a.ctx.organizationId));
    const [process] = await db.insert(productionProcesses).values({ organizationId: a.ctx.organizationId, facilityId: a.facility.id, feedstockTypeId: intake.feedstockTypeId }).returning();
    const [batch] = await db.insert(creditBatches).values({ organizationId: a.ctx.organizationId, facilityId: a.facility.id,
      feedstockTypeId: intake.feedstockTypeId, productionProcessId: process.id, code: `CB-AP-${a.tag}`, startDate: "2026-09-01", endDate: "2026-09-30" }).returning();
    await db.insert(creditBatchApplications).values({ organizationId: a.ctx.organizationId, creditBatchId: batch.id,
      applicationId: credited.id, allocatedWetMassKg: 25, allocatedDryMassKg: 20 });
    await db.insert(creditBatchProductionRuns).values({ organizationId: a.ctx.organizationId, creditBatchId: batch.id, productionRunId: a.runs[0].id });
    const [product, mixProduct] = await db.insert(biocharProducts).values(["CREDITED", "MIX"].map(suffix => ({ organizationId: a.ctx.organizationId, facilityId: a.facility.id,
      code: `BP-AP-${suffix}-${a.tag}`, formulationId: a.recipe.id, sourceBiocharStorageLocationId: a.source.id, storageLocationId: a.bin.id,
      productionDate: new Date("2026-09-12"), placedAt: new Date("2026-09-12"), massKg: 100, moistureContentPercent: 20, waterAddedKg: 0 }))).returning();
    // A frozen pro-rata product draw keeps only its applications out of credit slices.
    const [movement] = await db.insert(binMovements).values({ organizationId: a.ctx.organizationId, storageLocationId: a.source.id,
      lane: "biochar", movementType: "adjustment", massDeltaKg: -80, reason: "Product draw", outputKind: "product_draw",
      occurredAt: mixProduct.placedAt, idempotencyKey: `mix-product-${a.tag}`, basisFingerprint: "fixture", inputSnapshot: {},
      outputDryDeltaKg: "-80.000", balanceBeforeDryKg: "900.000", balanceAfterDryKg: "820.000" }).returning();
    await db.insert(outputStockAllocations).values({ organizationId: a.ctx.organizationId, movementId: movement.id,
      sourceStorageLocationId: a.source.id, productionRunId: a.runs[0].id, targetBiocharProductId: mixProduct.id,
      wetMassKg: "100.000", dryMassKg: "80.000", basisSnapshot: { policy: PRO_RATA_POLICY } });
    await db.insert(applicationOutputAllocations).values([
      { organizationId: a.ctx.organizationId, applicationId: credited.id, deliveryId: a.delivery.id, biocharProductId: product.id, productionRunId: a.runs[0].id, wetMassKg: "25.000", dryMassKg: "20.000" },
      { organizationId: a.ctx.organizationId, applicationId: heldOut.id, deliveryId: a.delivery.id, biocharProductId: mixProduct.id, productionRunId: a.runs[0].id, wetMassKg: "25.000", dryMassKg: "20.000" },
      { organizationId: a.ctx.organizationId, applicationId: unrelated.id, deliveryId: a.delivery.id, biocharProductId: product.id, productionRunId: a.runs[1].id, wetMassKg: "25.000", dryMassKg: "20.000" },
    ]);
    expect(await getMixBinHeldApplicationIds(a.ctx, db, [credited.id, heldOut.id, unrelated.id])).toEqual(new Set([heldOut.id]));
    expect((await ids(await list(`?creditBatchId=${batch.id.toUpperCase()}`))).sort()).toEqual([credited.id, heldOut.id].sort());
    expect((await (await get(heldOut.id)).json()).data.allocations).toEqual([{ biocharProductId: mixProduct.id, productionRunId: a.runs[0].id, wetMassKg: 25, dryBiocharKg: 20 }]);
    await lookupProblem(await list(`?creditBatchId=${UNKNOWN_READ_ID}`), 404, "not_found");
    const b = await createApiApplicationReadFixture();
    try { await lookupProblem(await list(`?creditBatchId=${batch.id}`, b.applicationKey), 404, "not_found"); }
    finally { await removeApiApplicationReadFixture(b); }
  });

  it("hides archived truck applications from lists and retains detail and boundary reads", async () => {
    const row = await insertReadApplication(a, { gisBoundary: TEST_GIS_BOUNDARY });
    await db.update(deliveries).set({ archivedAt: new Date() }).where(eq(deliveries.id, a.delivery.id));
    expect(await ids(await list())).toEqual([]);
    expect((await get(row.id)).status).toBe(200);
    expect((await boundary(row.code)).status).toBe(200);
  });

  it("checks read scope before foreign or unknown resources and refuses foreign reference filters", async () => {
    const row = await insertReadApplication(a);
    const b = await createApiApplicationReadFixture();
    try {
      for (const id of [row.id, row.id.toUpperCase(), row.code, UNKNOWN_READ_ID, "missing"]) {
        await lookupProblem(await get(id, b.applicationKey), 404, "not_found");
        await lookupProblem(await boundary(id, b.applicationKey), 404, "not_found");
        await lookupProblem(await get(id, a.applicationWriteKey), 403, "missing_scope");
        await lookupProblem(await boundary(id, a.deliveryKey), 403, "missing_scope");
      }
      for (const [field, id] of [["facilityId", a.facility.id], ["deliveryId", a.delivery.id], ["orderId", a.order.id]]) {
        await lookupProblem(await list(`?${field}=${id}`, b.applicationKey), 404, "not_found");
        await lookupProblem(await list(`?${field}=${UNKNOWN_READ_ID}`), 404, "not_found");
      }
      await lookupProblem(await list(`?deliveryId=${UNKNOWN_READ_ID}`, a.applicationWriteKey), 403, "missing_scope");
    } finally { await removeApiApplicationReadFixture(b); }
  });

  it("serves full geometry and summary with strong ETags and ignores If-None-Match", async () => {
    const row = await insertReadApplication(a, { gisBoundary: TEST_GIS_BOUNDARY });
    const response = await boundary(row.id.toUpperCase());
    const { data } = await response.json();
    expect(data).toEqual({ collection: TEST_GIS_BOUNDARY.collection, areaHectares: TEST_GIS_BOUNDARY.stats.areaHectares,
      featureCount: 1, vertexCount: 5, bbox: TEST_GIS_BOUNDARY.stats.bbox, center: TEST_GIS_BOUNDARY.stats.center });
    const tag = response.headers.get("etag")!;
    expect((await get(row.id)).headers.get("etag")).toBe(tag);
    for (const validator of [tag, `W/${tag}`, `"999.1", ${tag}`, "*"]) {
      const response = await get(row.id, a.applicationKey, validator);
      expect(response.status).toBe(200);
      expect((await response.json()).data.id).toBe(row.id);
      expect(response.headers.get("etag")).toBe(tag);
      const boundaryResponse = await boundary(row.id, a.applicationKey, validator);
      expect(boundaryResponse.status).toBe(200);
      expect((await boundaryResponse.json()).data).toEqual(data);
      expect(boundaryResponse.headers.get("etag")).toBe(tag);
    }
    await addReadApplicationAllocation(a, row);
    await runOperationInProcess(updateApplication, a.ctx, { applicationId: row.id, expectedVersion: row.version, fieldIdentifier: "Changed" });
    const updated = await get(row.id, a.applicationKey, tag);
    expect(updated.status).toBe(200);
    expect(updated.headers.get("etag")).toBe('"2.1"');
    expect((await boundary(row.id, a.applicationKey, tag)).status).toBe(200);
    const absent = await insertReadApplication(a);
    await lookupProblem(await boundary(absent.id), 404, "not_found");
    await lookupProblem(await boundary(absent.id, a.applicationKey, "*"), 404, "not_found");
    const invalidQuery = readRequest(`/applications/${row.id}?q=x`, a.applicationKey);
    await lookupProblem(await GET(invalidQuery, readParams(row.id)), 400, "invalid_query");
  });
});
