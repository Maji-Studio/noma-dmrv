import { TEST_SITE_POSITION } from "./helpers/test-org";
/** Real handlers, credentials and Postgres. Written for reviewer execution; never run by the implementation agent. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches, facilities, productionRuns, samples } from "@/db/schema";
import { GET as LIST } from "@/app/api/v1/lab-samples/route";
import { GET } from "@/app/api/v1/lab-samples/[idOrCode]/route";
import { labSampleRepresentationSchema } from "@/lib/representations/lab-samples";
import {
  createApiLabFixture, expectProblem, insertApiSample, labApiParams, labApiRequest, removeApiLabFixture, type ApiLabFixture,
} from "./helpers/api-lab-sample-fixture";

const TIMEOUT_MS = 60_000;
const PAGE_LIMIT = 1;
const FIRST_SAMPLED = "2026-09-10T08:00:00.000Z";
const SECOND_SAMPLED = "2026-09-11T08:00:00.000Z";
const AUGUST_SAMPLED = "2026-08-10T08:00:00.000Z";
const ARCHIVED_AT = new Date("2026-10-01T00:00:00.000Z");
/** Fields that must never reach a client, whatever the row carries. */
const PRIVATE_FIELDS = ["organizationId", "facilityId", "durabilityOption", "creditBatchCode", "productionRunId", "timeZone", "sampleCode", "arsenicMgKg", "r0HistogramFileUrl", "tgaThermogramFileUrl", "cursorCreatedAt"];

let a: ApiLabFixture;
let b: ApiLabFixture;
type Seeded = Awaited<ReturnType<typeof insertApiSample>>;
let first: Seeded;
let second: Seeded;
let august: Seeded;
const list = (query = "", key = a.key) => LIST(labApiRequest("lab-samples", query, key));
const get = (identifier: string, key = a.key, query = "") =>
  GET(labApiRequest("lab-samples", `/${encodeURIComponent(identifier)}${query}`, key), labApiParams(identifier));
const ids = async (response: Response) => (await response.json()).data.map((row: { id: string }) => row.id);

beforeEach(async () => {
  a = await createApiLabFixture();
  b = await createApiLabFixture();
  first = await insertApiSample(a, {
    code: `SAM-API-1-${a.tag}`, creditBatchId: a.batchA.id, samplingTime: FIRST_SAMPLED, createdAt: "2026-10-01T11:00:00.000Z",
    values: {
      labName: "Test Lab", labAccreditation: "ISO 17025", analysisDate: "2026-09-12", weightGrams: 50, volumeMl: 25,
      inorganicCarbonPercent: 2, totalHydrogenPercent: 2.5, totalNitrogenPercent: 0.5, totalOxygenPercent: 8, totalSulfurPercent: 0.1,
      ashContentPercent: 0, moistureContentPercent: 4, bulkDensityKgPerM3: 250, ph: 9.1, saltContentGPerKg: 1.5,
      hToCOrgRatio: 0.3815, oToCOrgRatio: 0.077, randomReflectanceR0Percent: 2.4, sReflectanceFraction: 0.5, r0MeasurementCount: 500,
      r0AnalysisDate: "2026-09-13", reactiveCarbonPercent: 10, residualCarbonPercent: 70, tgaAnalysisDate: "2026-09-14",
      phosphorusPercent: 0.2, potassiumPercent: 0.3, magnesiumPercent: 0.4, calciumPercent: 0.5, ironPercent: 0.6,
    },
  });
  second = await insertApiSample(a, { code: `SAM-API-2-${a.tag}`, creditBatchId: a.batchA.id, samplingTime: SECOND_SAMPLED, createdAt: "2026-10-01T12:00:00.000Z" });
  august = await insertApiSample(a, { code: `SAM-API-3-${a.tag}`, creditBatchId: a.batchB!.id, samplingTime: AUGUST_SAMPLED, createdAt: "2026-10-01T13:00:00.000Z" });
}, TIMEOUT_MS);
afterEach(async () => { await removeApiLabFixture(a); await removeApiLabFixture(b); }, TIMEOUT_MS);

describe("lab sample reads", { timeout: TIMEOUT_MS }, () => {
  it("gets a sample by id and code with the stored facts, ids and UTC instants only, and a strong ETag", async () => {
    for (const identifier of [first.id, first.sampleCode]) {
      const response = await get(identifier);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("etag")).toBe(`"${first.version}.1"`);
      const { data } = await response.json();
      expect(labSampleRepresentationSchema.parse(data)).toEqual(data);
      expect(Object.keys(data).sort()).toEqual(Object.keys(labSampleRepresentationSchema.shape).sort());
      expect(data).toEqual({
        id: first.id, code: first.sampleCode, version: first.version, creditBatchId: a.batchA.id, samplingTime: FIRST_SAMPLED,
        labName: "Test Lab", labAccreditation: "ISO 17025", analysisDate: "2026-09-12", weightGrams: 50, volumeMl: 25,
        totalCarbonPercent: 80, organicCarbonPercent: 78, inorganicCarbonPercent: 2,
        totalHydrogenPercent: 2.5, totalNitrogenPercent: 0.5, totalOxygenPercent: 8, totalSulfurPercent: 0.1,
        ashContentPercent: 0, moistureContentPercent: 4, bulkDensityKgPerM3: 250, ph: 9.1, saltContentGPerKg: 1.5,
        hToCOrgRatio: 0.3815, oToCOrgRatio: 0.077, randomReflectanceR0Percent: 2.4, sReflectanceFraction: 0.5, r0MeasurementCount: 500,
        r0AnalysisDate: "2026-09-13", reactiveCarbonPercent: 10, residualCarbonPercent: 70, tgaAnalysisDate: "2026-09-14",
        phosphorusPercent: 0.2, potassiumPercent: 0.3, magnesiumPercent: 0.4, calciumPercent: 0.5, ironPercent: 0.6,
        createdAt: "2026-10-01T11:00:00.000Z", updatedAt: "2026-10-01T11:00:00.000Z",
      });
      for (const field of PRIVATE_FIELDS) expect(data).not.toHaveProperty(field);
    }
  });

  it("returns identical bytes on repeated reads and null for the optional facts a sample lacks", async () => {
    const firstRead = await (await get(first.id)).text();
    expect(await (await get(first.id)).text()).toBe(firstRead);
    const { data } = await (await get(second.id)).json();
    expect(data).toMatchObject({ labName: null, weightGrams: null, hToCOrgRatio: null, oToCOrgRatio: null, r0MeasurementCount: null, tgaAnalysisDate: null, creditBatchId: a.batchA.id });
  });

  it("bumps the ETag when the row version changes", async () => {
    const before = (await get(first.id)).headers.get("etag");
    await db.update(samples).set({ version: sql`${samples.version} + 1` }).where(and(eq(samples.id, first.id), eq(samples.organizationId, a.ctx.organizationId)));
    expect((await get(first.id)).headers.get("etag")).toBe(`"${first.version + 1}.1"`);
    expect(before).toBe(`"${first.version}.1"`);
  });

  it("lists newest first and paginates by cursor without totals", async () => {
    expect(await ids(await list())).toEqual([august.id, second.id, first.id]);
    const page = await (await list(`?limit=${PAGE_LIMIT}`)).json();
    expect(page.data.map((row: { id: string }) => row.id)).toEqual([august.id]);
    expect(page.nextCursor).toBeTruthy();
    expect(page).not.toHaveProperty("total");
    const seen = [...page.data.map((row: { id: string }) => row.id)];
    let cursor = page.nextCursor as string | null;
    while (cursor) {
      const next = await (await list(`?limit=${PAGE_LIMIT}&cursor=${cursor}`)).json();
      seen.push(...next.data.map((row: { id: string }) => row.id));
      cursor = next.nextCursor;
    }
    expect(seen).toEqual([august.id, second.id, first.id]);
  });

  it("filters by every published filter", async () => {
    const only = async (query: string) => ids(await list(`?${query}`));
    expect(await only(`creditBatchId=${a.batchA.id}`)).toEqual([second.id, first.id]);
    expect(await only(`creditBatchId=${a.batchB!.id}`)).toEqual([august.id]);
    // The facility filter matches through the batch.
    expect(await only(`facilityId=${a.facility.id}`)).toEqual([august.id, second.id, first.id]);
    expect(await only(`facilityId=${a.facility.id}&creditBatchId=${a.batchA.id}`)).toEqual([second.id, first.id]);
    expect(await only(`code=${encodeURIComponent(first.sampleCode)}`)).toEqual([first.id]);
    expect(await only("code=missing")).toEqual([]);
    expect(await only("q=sam-api-")).toEqual([august.id, second.id, first.id]);
    expect(await only("q=sam-api-1")).toEqual([first.id]);
    expect(await only("q=%25")).toEqual([]);
    expect(await only(`sampledFrom=${encodeURIComponent(SECOND_SAMPLED)}`)).toEqual([second.id]);
    expect(await only(`sampledBefore=${encodeURIComponent(SECOND_SAMPLED)}`)).toEqual([august.id, first.id]);
    expect(await only(`sampledFrom=${encodeURIComponent(FIRST_SAMPLED)}&sampledBefore=${encodeURIComponent(SECOND_SAMPLED)}`)).toEqual([first.id]);
    expect(await only(`sampledFrom=${encodeURIComponent("2026-09-10T11:00:00+03:00")}&sampledBefore=${encodeURIComponent("2026-09-10T11:00:01+03:00")}`)).toEqual([first.id]);
  });

  it("binds cursors to the organization and the filter set", async () => {
    const page = await (await list(`?limit=${PAGE_LIMIT}`)).json();
    await expectProblem(await list(`?creditBatchId=${a.batchA.id}&cursor=${page.nextCursor}`), 400, "invalid_cursor");
    await expectProblem(await list(`?cursor=${page.nextCursor}`, b.key), 400, "invalid_cursor");
  });

  it("rejects invalid, repeated and unknown queries and an offset-less instant", async () => {
    for (const query of ["?unknown=1", "?limit=0", "?limit=1&limit=2", "?q=a&q=b", "?facilityId=nope", "?creditBatchId=nope", "?status=pending",
      "?sampledFrom=2026-09-12T12:00:00", "?sampledBefore=2026-09-12"]) {
      await expectProblem(await list(query), 400, "invalid_query");
    }
    await expectProblem(await get(first.id, a.key, "?q=a"), 400, "invalid_query");
  });

  it("hides samples on an archived batch from lists but reads them by id and code", async () => {
    await db.update(creditBatches).set({ archivedAt: ARCHIVED_AT })
      .where(and(eq(creditBatches.id, a.batchB!.id), eq(creditBatches.organizationId, a.ctx.organizationId)));
    expect(await ids(await list())).toEqual([second.id, first.id]);
    expect(await ids(await list(`?facilityId=${a.facility.id}`))).toEqual([second.id, first.id]);
    // The batch itself still exists for this organization, so filtering on it is an empty page, not a 404.
    expect(await ids(await list(`?creditBatchId=${a.batchB!.id}`))).toEqual([]);
    for (const identifier of [august.id, august.sampleCode]) {
      const response = await get(identifier);
      expect(response.status).toBe(200);
      expect((await response.json()).data).toMatchObject({ id: august.id, creditBatchId: a.batchB!.id });
    }
  });

  it("uses the batch facility even when provenance points to another facility", async () => {
    const [other] = await db.insert(facilities).values({ ...TEST_SITE_POSITION, timezone: "UTC", organizationId: a.ctx.organizationId, code: `E2E-LAB-F2-${a.tag}`, name: `E2E Lab F2 ${a.tag}` }).returning();
    const moved = await insertApiSample(a, {
      code: `SAM-API-MOVED-${a.tag}`, creditBatchId: a.batchA.id, productionRunId: a.runs[0].id, samplingTime: FIRST_SAMPLED, createdAt: "2026-10-01T14:00:00.000Z",
    });
    await db.update(productionRuns).set({ facilityId: other.id })
      .where(and(eq(productionRuns.id, a.runs[0].id), eq(productionRuns.organizationId, a.ctx.organizationId)));
    expect(await ids(await list(`?facilityId=${other.id}`))).toEqual([]);
    expect(await ids(await list(`?facilityId=${a.facility.id}`))).toContain(moved.id);
  });

  it("canonicalizes uppercase UUIDs in the path and in filters", async () => {
    const upper = await get(first.id.toUpperCase());
    expect(upper.status).toBe(200);
    expect((await upper.json()).data.id).toBe(first.id);
    expect(upper.headers.get("etag")).toBe(`"${first.version}.1"`);
    expect(await ids(await list(`?creditBatchId=${a.batchA.id.toUpperCase()}`))).toEqual([second.id, first.id]);
    expect(await ids(await list(`?facilityId=${a.facility.id.toUpperCase()}`))).toHaveLength(3);
    // One filter set, one cursor: a cursor made under the lowercase id works under the uppercase one.
    const page = await (await list(`?creditBatchId=${a.batchA.id}&limit=${PAGE_LIMIT}`)).json();
    expect(await ids(await list(`?creditBatchId=${a.batchA.id.toUpperCase()}&limit=${PAGE_LIMIT}&cursor=${page.nextCursor}`))).toEqual([first.id]);
    await expectProblem(await get(first.id.toUpperCase(), b.key), 404, "not_found");
  });

  it("answers 404 for foreign ids, codes and filters without echoing them, and for unknown samples", async () => {
    for (const identifier of [first.id, first.sampleCode, "missing"]) {
      const refusal = await expectProblem(await get(identifier, b.key), 404, "not_found");
      expect(refusal.errors).toEqual([{ pointer: "/labSampleId", code: "not_found", detail: expect.any(String) }]);
      // `instance` echoes the caller's own request path; nothing else may.
      expect(JSON.stringify({ ...refusal, instance: undefined })).not.toContain(first.sampleCode);
    }
    expect(await ids(await list("", b.key))).toEqual([]);
    for (const [filter, value] of [["facilityId", a.facility.id], ["creditBatchId", a.batchA.id], ["creditBatchId", a.batchA.id.toUpperCase()]]) {
      const refusal = await expectProblem(await list(`?${filter}=${value}`, b.key), 404, "not_found");
      expect(refusal.errors[0].pointer).toBe(`/${filter}`);
      expect(JSON.stringify(refusal)).not.toContain(a.batchA.code);
    }
    expect(await ids(await list(`?code=${encodeURIComponent(first.sampleCode)}`, b.key))).toEqual([]);
  });

  it("refuses each route without the lab sample read scope, before any lookup", async () => {
    // Write and delete scopes alone grant no read; a credit batch key grants no sample read.
    for (const key of [a.otherScopeKey, a.writeOnlyKey, a.creditBatchesOnlyKey]) {
      await expectProblem(await list("", key), 403, "missing_scope");
      await expectProblem(await get(first.id, key), 403, "missing_scope");
      // 403 comes before 404: an unknown id and a foreign id are not distinguishable without the scope.
      await expectProblem(await get("missing", key), 403, "missing_scope");
      await expectProblem(await list(`?creditBatchId=${b.batchA.id}`, key), 403, "missing_scope");
    }
    expect((await list("", a.labSamplesOnlyKey)).status).toBe(200);
  });
});
