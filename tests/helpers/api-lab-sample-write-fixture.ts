/** Request builders and state readers for the lab sample REST write suites. */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
import { db } from "@/db";
import { apiAuditEvents, apiIdempotencyRecords, samples } from "@/db/schema";
import { POST } from "@/app/api/v1/lab-samples/route";
import { DELETE, GET, PATCH } from "@/app/api/v1/lab-samples/[idOrCode]/route";
import { labSampleRepresentationSchema } from "@/lib/representations/lab-samples";
import { labApiParams, type ApiLabFixture } from "./api-lab-sample-fixture";

const API_URL = "http://localhost:3100/api/v1";
const AUDIT_ENTITY = "labSample";
/** Inside batch A's September window, before now. */
export const WRITE_SAMPLED_AT = "2026-09-10T08:00:00.000Z";
export const FUTURE_AT = "2099-01-01T00:00:00.000Z";

export function labWriteRequest(f: ApiLabFixture, method: string, path: string, body?: unknown, headers: Record<string, string> = {}, key = f.writeKey) {
  return new Request(`${API_URL}${path}`, {
    method, headers: { authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** A create body: carbon totals and hydrogen, so H/C_org is calculated (1.5 / 1.008) / (75 / 12.011). */
export const labSampleBody = (f: ApiLabFixture, changes: Record<string, unknown> = {}) => ({
  creditBatchId: f.batchA.id, samplingTime: WRITE_SAMPLED_AT, totalCarbonPercent: 80, organicCarbonPercent: 75,
  totalHydrogenPercent: 1.5, moistureContentPercent: 10, ...changes,
});
export const EXPECTED_H_TO_C = 0.2383;

export const postLabSample = (f: ApiLabFixture, body: unknown, key: string | null = randomUUID(), query = "", writeKey = f.writeKey) =>
  POST(labWriteRequest(f, "POST", `/lab-samples${query}`, body, key === null ? {} : { "idempotency-key": key }, writeKey));
export const patchLabSample = (f: ApiLabFixture, id: string, body: unknown, etag?: string, query = "", headers: Record<string, string> = {}, writeKey = f.writeKey) =>
  PATCH(labWriteRequest(f, "PATCH", `/lab-samples/${id}${query}`, body, { ...(etag === undefined ? {} : { "if-match": etag }), ...headers }, writeKey), labApiParams(id));
export const deleteLabSample = (f: ApiLabFixture, id: string, etag?: string, query = "", body?: unknown, key = f.deleteKey, headers: Record<string, string> = {}) =>
  DELETE(labWriteRequest(f, "DELETE", `/lab-samples/${id}${query}`, body, { ...(etag === undefined ? {} : { "if-match": etag }), ...headers }, key), labApiParams(id));

export function requiredEtag(response: Response): string {
  const etag = response.headers.get("etag");
  expect(etag).toBeTruthy();
  return etag!;
}

/** Create through the endpoint and return the parsed sample with its ETag. */
export async function seedRestLabSample(f: ApiLabFixture, body: unknown = labSampleBody(f)) {
  const response = await postLabSample(f, body);
  expect(response.status).toBe(201);
  return { row: labSampleRepresentationSchema.parse((await response.json()).data), etag: requiredEtag(response) };
}

export async function readRestLabSample(f: ApiLabFixture, id: string) {
  const response = await GET(labWriteRequest(f, "GET", `/lab-samples/${id}`, undefined, {}, f.key), labApiParams(id));
  expect(response.status).toBe(200);
  return { row: labSampleRepresentationSchema.parse((await response.json()).data), etag: requiredEtag(response) };
}

/** Actual rows, independent of the API projection. */
export const labSampleRows = (f: ApiLabFixture) =>
  db.select().from(samples).where(eq(samples.organizationId, f.ctx.organizationId)).orderBy(samples.sampleCode);

export const labSampleAudits = (f: ApiLabFixture) =>
  db.select().from(apiAuditEvents).where(and(eq(apiAuditEvents.organizationId, f.ctx.organizationId), eq(apiAuditEvents.entityType, AUDIT_ENTITY)));
export const labIdempotencyRecords = (f: ApiLabFixture) =>
  db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, f.ctx.organizationId));

/** Nothing saved, audited or claimed. */
export async function expectNoLabSampleWrite(f: ApiLabFixture, records = 0) {
  expect(await labSampleRows(f)).toEqual([]);
  expect(await labSampleAudits(f)).toEqual([]);
  expect(await labIdempotencyRecords(f)).toHaveLength(records);
}
