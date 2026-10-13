/**
 * Real credentials over the lab sample fixture, for the REST read suites. Each
 * fixture owns an organization with two credit batches on one facility.
 */
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { db } from "@/db";
import { members, samples } from "@/db/schema";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { createApiKey } from "@/data-access/api-keys";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { cleanupLabSampleFixture, createLabSampleFixture, type LabSampleFixture, type LabSampleFixtureOptions } from "./lab-sample-fixture";

const API_BASE = "http://localhost:3100/api/v1";
export const READ_SCOPES: readonly ApiScope[] = ["lab-samples:read", "credit-batches:read", "facilities:read"];

export interface ApiLabFixture extends LabSampleFixture {
  /** Reads lab samples, credit batches and facilities. */
  key: string;
  labSamplesOnlyKey: string;
  creditBatchesOnlyKey: string;
  /** Write and delete scopes alone: they must not grant any read. */
  writeOnlyKey: string;
  /** `lab-samples:write` alone: it must not delete or read. */
  writeKey: string;
  writeCredentialId: string;
  /** `lab-samples:delete` alone. */
  deleteKey: string;
  otherScopeKey: string;
}

async function issueCredential(f: LabSampleFixture, name: string, scopes: readonly ApiScope[]) {
  return createApiKey(f.ctx, { name, scopes: [...scopes], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS });
}
async function issueKey(f: LabSampleFixture, name: string, scopes: readonly ApiScope[]) {
  return (await issueCredential(f, name, scopes)).key;
}

export async function createApiLabFixture(options: LabSampleFixtureOptions = {}): Promise<ApiLabFixture> {
  const f = await createLabSampleFixture(options);
  await db.insert(members).values({ id: randomUUID(), organizationId: f.ctx.organizationId, userId: f.ctx.userId, role: "owner" });
  const writer = await issueCredential(f, "Lab sample writer", ["lab-samples:write"]);
  return {
    ...f,
    writeKey: writer.key,
    writeCredentialId: writer.id,
    deleteKey: await issueKey(f, "Lab sample deleter", ["lab-samples:delete"]),
    key: await issueKey(f, "Lab reader", READ_SCOPES),
    labSamplesOnlyKey: await issueKey(f, "Lab samples only", ["lab-samples:read"]),
    creditBatchesOnlyKey: await issueKey(f, "Credit batches only", ["credit-batches:read"]),
    writeOnlyKey: await issueKey(f, "Lab writer", ["lab-samples:write", "lab-samples:delete"]),
    otherScopeKey: await issueKey(f, "Other scope", ["feedstocks:read"]),
  };
}

export async function removeApiLabFixture(f: ApiLabFixture) {
  await cleanupLabSampleFixture(f);
}

export interface ApiSampleSeed {
  code: string;
  creditBatchId: string | null;
  samplingTime: string;
  createdAt: string;
  productionRunId?: string;
  values?: Partial<typeof samples.$inferInsert>;
}

/** Writes one sample row directly, so a test controls its creation instant and every column. */
export async function insertApiSample(f: LabSampleFixture, seed: ApiSampleSeed) {
  const [row] = await db.insert(samples).values({
    organizationId: f.ctx.organizationId, sampleCode: seed.code, creditBatchId: seed.creditBatchId,
    productionRunId: seed.productionRunId ?? null, samplingTime: new Date(seed.samplingTime),
    totalCarbonPercent: 80, organicCarbonPercent: 78, createdAt: new Date(seed.createdAt), updatedAt: new Date(seed.createdAt),
    ...seed.values,
  }).returning();
  return row;
}

export function labApiRequest(resource: string, path: string, key: string) {
  return new Request(`${API_BASE}/${resource}${path}`, { headers: { authorization: `Bearer ${key}` } });
}
export const labApiParams = (idOrCode: string) => ({ params: Promise.resolve({ idOrCode }) });

export async function expectProblem(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/problem+json");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const body = await response.json();
  expect(body.code).toBe(code);
  return body;
}
