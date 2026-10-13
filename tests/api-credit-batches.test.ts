/** Real handlers, credentials and Postgres. Written for reviewer execution; never run by the implementation agent. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches, facilities, productionProcesses } from "@/db/schema";
import { GET as LIST } from "@/app/api/v1/credit-batches/route";
import { GET } from "@/app/api/v1/credit-batches/[idOrCode]/route";
import { creditBatchRepresentationSchema } from "@/lib/representations/credit-batches";
import {
  createApiLabFixture, expectProblem, labApiParams, labApiRequest, removeApiLabFixture, type ApiLabFixture,
} from "./helpers/api-lab-sample-fixture";

const TIMEOUT_MS = 60_000;
const PAGE_LIMIT = 1;
const ARCHIVED_AT = new Date("2026-10-01T00:00:00.000Z");
/** Fields of the rich batch result and its joins that must never reach a client. */
const PRIVATE_FIELDS = ["organizationId", "productionProcessId", "durabilityOption", "hToCorgRatio", "fDurableCalculated", "value", "currency",
  "bufferPoolPercent", "certifier", "registry", "co2eStored", "cursorCreatedAt"];

let a: ApiLabFixture;
let b: ApiLabFixture;
let unsampled: { id: string; code: string };
const list = (query = "", key = a.key) => LIST(labApiRequest("credit-batches", query, key));
const get = (identifier: string, key = a.key, query = "") =>
  GET(labApiRequest("credit-batches", `/${encodeURIComponent(identifier)}${query}`, key), labApiParams(identifier));
const ids = async (response: Response) => (await response.json()).data.map((row: { id: string }) => row.id);

/** Newest first by (createdAt, id), read from the database rather than assumed from insert order. */
async function newestFirst(f: ApiLabFixture) {
  const rows = await db.select({ id: creditBatches.id }).from(creditBatches)
    .where(eq(creditBatches.organizationId, f.ctx.organizationId)).orderBy(desc(creditBatches.createdAt), desc(creditBatches.id));
  return rows.map((row) => row.id);
}

beforeEach(async () => {
  a = await createApiLabFixture();
  b = await createApiLabFixture();
  const [process] = await db.select({ id: productionProcesses.id }).from(productionProcesses).where(eq(productionProcesses.organizationId, a.ctx.organizationId));
  const [row] = await db.insert(creditBatches).values({
    organizationId: a.ctx.organizationId, code: `E2E-LAB-CB-${a.tag}-U`, facilityId: a.facility.id, feedstockTypeId: a.feedstockTypeId,
    productionProcessId: process.id, status: "draft", sampling: "unsampled", startDate: "2026-10-01", endDate: "2026-10-31",
  }).returning();
  unsampled = row;
}, TIMEOUT_MS);
afterEach(async () => { await removeApiLabFixture(a); await removeApiLabFixture(b); }, TIMEOUT_MS);

describe("credit batch lookups", { timeout: TIMEOUT_MS }, () => {
  it("gets a batch by id and code as the narrow projection with a strong ETag", async () => {
    for (const identifier of [a.batchA.id, a.batchA.code]) {
      const response = await get(identifier);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("etag")).toBe('"1.1"');
      const { data } = await response.json();
      expect(creditBatchRepresentationSchema.parse(data)).toEqual(data);
      expect(data).toEqual({
        id: a.batchA.id, code: a.batchA.code, version: 1, facilityId: a.facility.id, feedstockTypeId: a.feedstockTypeId,
        status: "pending", sampling: "sampled", startDate: "2026-09-01", endDate: "2026-09-30", archivedAt: null,
        createdAt: expect.any(String), updatedAt: expect.any(String),
      });
      for (const field of PRIVATE_FIELDS) expect(data).not.toHaveProperty(field);
    }
    const { data } = await (await get(unsampled.id)).json();
    expect(data).toMatchObject({ status: "draft", sampling: "unsampled", startDate: "2026-10-01", endDate: "2026-10-31" });
  });

  it("returns identical bytes on repeated reads and bumps the ETag with the row version", async () => {
    const read = await (await get(a.batchA.id)).text();
    expect(await (await get(a.batchA.id)).text()).toBe(read);
    await db.update(creditBatches).set({ version: 2 }).where(and(eq(creditBatches.id, a.batchA.id), eq(creditBatches.organizationId, a.ctx.organizationId)));
    expect((await get(a.batchA.id)).headers.get("etag")).toBe('"2.1"');
  });

  it("lists newest first and paginates by cursor without totals", async () => {
    const order = await newestFirst(a);
    expect(await ids(await list())).toEqual(order);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { data: { id: string }[]; nextCursor: string | null } = await (await list(`?limit=${PAGE_LIMIT}${cursor ? `&cursor=${cursor}` : ""}`)).json();
      expect(page).not.toHaveProperty("total");
      seen.push(...page.data.map((row) => row.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(order);
  });

  it("filters by facility, status, sampling, exact code and code prefix", async () => {
    const only = async (query: string) => (await ids(await list(`?${query}`))).sort();
    const sorted = (...rows: { id: string }[]) => rows.map((row) => row.id).sort();
    expect(await only(`facilityId=${a.facility.id}`)).toEqual(sorted(a.batchA, a.batchB!, unsampled));
    expect(await only("status=pending")).toEqual(sorted(a.batchA, a.batchB!));
    expect(await only("status=draft")).toEqual(sorted(unsampled));
    expect(await only("status=issued")).toEqual([]);
    expect(await only("sampling=unsampled")).toEqual(sorted(unsampled));
    expect(await only("sampling=sampled&status=pending")).toEqual(sorted(a.batchA, a.batchB!));
    expect(await only(`code=${encodeURIComponent(a.batchA.code)}`)).toEqual(sorted(a.batchA));
    expect(await only("code=missing")).toEqual([]);
    expect(await only(`q=${encodeURIComponent(a.batchA.code.toLowerCase())}`)).toEqual(sorted(a.batchA));
    expect(await only("q=e2e-lab-cb-")).toEqual(sorted(a.batchA, a.batchB!, unsampled));
    expect(await only("q=%25")).toEqual([]);
  });

  it("binds cursors to the organization and the filter set", async () => {
    const page = await (await list(`?limit=${PAGE_LIMIT}`)).json();
    await expectProblem(await list(`?status=pending&cursor=${page.nextCursor}`), 400, "invalid_cursor");
    await expectProblem(await list(`?cursor=${page.nextCursor}`, b.key), 400, "invalid_cursor");
  });

  it("rejects invalid, repeated and unknown queries", async () => {
    for (const query of ["?unknown=1", "?status=archived", "?sampling=maybe", "?limit=0", "?limit=1&limit=2", "?q=a&q=b", "?facilityId=nope", "?creditBatchId=x"]) {
      await expectProblem(await list(query), 400, "invalid_query");
    }
    await expectProblem(await get(a.batchA.id, a.key, "?q=a"), 400, "invalid_query");
  });

  it("hides archived batches from lists, as other lookups do, but reads them by id and code", async () => {
    await db.update(creditBatches).set({ archivedAt: ARCHIVED_AT }).where(and(eq(creditBatches.id, a.batchB!.id), eq(creditBatches.organizationId, a.ctx.organizationId)));
    expect(await ids(await list())).not.toContain(a.batchB!.id);
    expect(await ids(await list(`?code=${encodeURIComponent(a.batchB!.code)}`))).toEqual([]);
    for (const identifier of [a.batchB!.id, a.batchB!.code]) {
      const { data } = await (await get(identifier)).json();
      expect(data).toMatchObject({ id: a.batchB!.id, archivedAt: ARCHIVED_AT.toISOString() });
    }
  });

  it("canonicalizes uppercase UUIDs in the path and the facility filter", async () => {
    const upper = await get(a.batchA.id.toUpperCase());
    expect(upper.status).toBe(200);
    expect((await upper.json()).data.id).toBe(a.batchA.id);
    expect(await ids(await list(`?facilityId=${a.facility.id.toUpperCase()}`))).toHaveLength(3);
    const page = await (await list(`?facilityId=${a.facility.id}&limit=${PAGE_LIMIT}`)).json();
    expect((await list(`?facilityId=${a.facility.id.toUpperCase()}&limit=${PAGE_LIMIT}&cursor=${page.nextCursor}`)).status).toBe(200);
  });

  it("answers 404 for foreign ids, codes and facility filters without echoing them", async () => {
    for (const identifier of [a.batchA.id, a.batchA.code, unsampled.id, "missing"]) {
      const refusal = await expectProblem(await get(identifier, b.key), 404, "not_found");
      expect(refusal.errors).toEqual([{ pointer: "/creditBatchId", code: "not_found", detail: expect.any(String) }]);
      // `instance` echoes the caller's own request path; nothing else may.
      expect(JSON.stringify({ ...refusal, instance: undefined })).not.toContain(a.batchA.code);
    }
    expect(await ids(await list("", b.key))).toEqual(await newestFirst(b));
    expect(await ids(await list(`?code=${encodeURIComponent(a.batchA.code)}`, b.key))).toEqual([]);
    const refusal = await expectProblem(await list(`?facilityId=${a.facility.id}`, b.key), 404, "not_found");
    expect(refusal.errors[0].pointer).toBe("/facilityId");
  });

  it("refuses each route without the credit batch read scope, before any lookup", async () => {
    for (const key of [a.otherScopeKey, a.writeOnlyKey, a.labSamplesOnlyKey]) {
      await expectProblem(await list("", key), 403, "missing_scope");
      await expectProblem(await get(a.batchA.id, key), 403, "missing_scope");
      await expectProblem(await get("missing", key), 403, "missing_scope");
      await expectProblem(await list(`?facilityId=${b.facility.id}`, key), 403, "missing_scope");
    }
    expect((await list("", a.creditBatchesOnlyKey)).status).toBe(200);
  });

  it("keeps the facility tier off the batch: the facility representation owns it", async () => {
    await db.update(facilities).set({ durabilityOption: "1000_year" }).where(and(eq(facilities.id, a.facility.id), eq(facilities.organizationId, a.ctx.organizationId)));
    const { data } = await (await get(a.batchA.id)).json();
    expect(data).not.toHaveProperty("durabilityOption");
    expect(data.facilityId).toBe(a.facility.id);
  });
});
