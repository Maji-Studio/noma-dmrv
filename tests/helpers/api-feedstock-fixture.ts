import type { ApiScope } from "@/lib/auth/api-scopes";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
import { db } from "@/db";
import {
  feedstocks, members, productionRunFeedstockDraws, productionRunFeedstocks,
  productionRuns, reactors, storageLocations, transportLegs, users,
} from "@/db/schema";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { createApiKey } from "@/data-access/api-keys";
import { deriveFeedstockWetStockKg } from "@/data-access/feedstock-wet-stock";
import { GET, PATCH, DELETE } from "@/app/api/v1/feedstocks/[idOrCode]/route";
import { POST } from "@/app/api/v1/feedstocks/route";
import { createFeedstockSchema, type CreateFeedstockData } from "@/schemas/feedstocks";
import { feedstockRepresentationSchema, type FeedstockRepresentation } from "@/lib/representations/feedstocks";
import { addFixtureReactor, createIntakeFixture, removeIntakeFixture, type IntakeFixture } from "./operation-fixture";

export const PRODUCTION_RUN_FIXTURE_DRAW_WET_KG = 1200;
const PRODUCTION_RUN_FIXTURE_MOISTURE_PERCENT = 32.5;
const PRODUCTION_RUN_FIXTURE_START_TIME = "2026-10-06T10:00:00Z";

const API_URL = "http://localhost:3100/api/v1/feedstocks";
const INTAKE_SCOPES: readonly ApiScope[] = ["feedstocks:read", "feedstocks:write", "feedstocks:delete"];

export interface ApiFeedstockFixture extends IntakeFixture {
  key: string;
  credentialId: string;
}

/** Real credential owner; the action session mock must resolve this same ctx. */
export async function createApiFeedstockFixture(label: string, scopes: readonly ApiScope[] = INTAKE_SCOPES): Promise<ApiFeedstockFixture> {
  const fixture = await createIntakeFixture(`${label}-${randomUUID()}`);
  await db.insert(users).values({
    id: fixture.ctx.userId, email: `${fixture.ctx.userId}@example.test`,
    name: "Feedstock API fixture", emailVerified: true,
  });
  await db.insert(members).values({
    id: randomUUID(), organizationId: fixture.ctx.organizationId,
    userId: fixture.ctx.userId, role: "owner",
  });
  await db.update(storageLocations).set({ feedstockTypeId: fixture.feedstockTypeId })
    .where(and(eq(storageLocations.organizationId, fixture.ctx.organizationId), eq(storageLocations.id, fixture.binId)));
  const credential = await createApiKey(fixture.ctx, {
    name: "Feedstock suite", scopes: [...scopes], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS,
  });
  return { ...fixture, key: credential.key, credentialId: credential.id };
}

export async function removeApiFeedstockFixture(fixture: ApiFeedstockFixture): Promise<void> {
  const org = fixture.ctx.organizationId;
  await db.delete(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.organizationId, org));
  await db.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.organizationId, org));
  await db.delete(productionRuns).where(eq(productionRuns.organizationId, org));
  await db.delete(reactors).where(eq(reactors.organizationId, org));
  await removeIntakeFixture(fixture);
  await db.delete(users).where(eq(users.id, fixture.ctx.userId));
}

export function decodedIntake(fixture: IntakeFixture, wetMassKg?: number): CreateFeedstockData {
  return createFeedstockSchema.parse(fixture.input(wetMassKg));
}

export function feedstockRequest(
  fixture: ApiFeedstockFixture, method: string, path = "", body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`${API_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${fixture.key}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ idOrCode: id }) });

/** The only date encoding here is the canonical encoding of the decoded command. */
export function postFeedstock(fixture: ApiFeedstockFixture, command = decodedIntake(fixture), key: string = randomUUID()) {
  return POST(feedstockRequest(fixture, "POST", "", {
    ...command, deliveryDate: command.deliveryDate.toISOString().split("T")[0],
  }, { "idempotency-key": key }));
}

export const getFeedstock = (fixture: ApiFeedstockFixture, id: string) =>
  GET(feedstockRequest(fixture, "GET", `/${id}`), params(id));

export const patchFeedstock = (fixture: ApiFeedstockFixture, row: FeedstockRepresentation, etag: string, body: unknown) =>
  PATCH(feedstockRequest(fixture, "PATCH", `/${row.id}`, body, { "if-match": etag }), params(row.id));

export const deleteFeedstock = (fixture: ApiFeedstockFixture, row: FeedstockRepresentation, etag: string) =>
  DELETE(feedstockRequest(fixture, "DELETE", `/${row.id}`, undefined, { "if-match": etag }), params(row.id));

export async function readFeedstock(fixture: ApiFeedstockFixture, id: string) {
  const response = await getFeedstock(fixture, id);
  expect(response.status).toBe(200);
  return { row: feedstockRepresentationSchema.parse((await response.json()).data), etag: requiredEtag(response) };
}

export function requiredEtag(response: Response): string {
  const etag = response.headers.get("etag");
  expect(etag).toBeTruthy();
  if (!etag) throw new Error("Expected a feedstock ETag");
  return etag;
}

export async function seedApiFeedstock(fixture: ApiFeedstockFixture, wetMassKg?: number) {
  const response = await postFeedstock(fixture, decodedIntake(fixture, wetMassKg));
  expect(response.status).toBe(201);
  const { data } = await response.json();
  expect(data).toHaveLength(1);
  return { row: feedstockRepresentationSchema.parse(data[0]), etag: requiredEtag(response) };
}

export async function expectFeedstockProblem(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/problem+json");
  const body = await response.json();
  expect(body.code).toBe(code);
  return body;
}

export const binWetStock = (fixture: IntakeFixture) =>
  deriveFeedstockWetStockKg(fixture.ctx, db, fixture.binId);

export const committedFeedstocks = (fixture: IntakeFixture) =>
  db.select().from(feedstocks).where(eq(feedstocks.organizationId, fixture.ctx.organizationId)).orderBy(feedstocks.code);

/** Preserve target ids/preconditions so parity runs the exact same command twice. */
export async function captureFeedstockState(fixture: IntakeFixture) {
  return {
    rows: await committedFeedstocks(fixture),
    legs: await db.select().from(transportLegs).where(eq(transportLegs.organizationId, fixture.ctx.organizationId)),
  };
}

export async function restoreFeedstockState(fixture: IntakeFixture, state: Awaited<ReturnType<typeof captureFeedstockState>>) {
  await db.transaction(async (tx) => {
    const org = fixture.ctx.organizationId;
    await tx.delete(transportLegs).where(eq(transportLegs.organizationId, org));
    // Create parity starts empty. Update/delete parity reuses the seeded row,
    // including its original version, timestamps and production provenance.
    if (!state.rows.length) await tx.delete(feedstocks).where(eq(feedstocks.organizationId, org));
    for (const row of state.rows) {
      await tx.insert(feedstocks).values(row).onConflictDoUpdate({ target: feedstocks.id, set: row });
    }
    if (state.legs.length) await tx.insert(transportLegs).values(state.legs);
  });
}

export const derivedFeedstockLegs = (fixture: IntakeFixture, feedstockId: string) =>
  db.select().from(transportLegs).where(and(
    eq(transportLegs.organizationId, fixture.ctx.organizationId), eq(transportLegs.entityType, "feedstock"),
    eq(transportLegs.entityId, feedstockId), eq(transportLegs.isDerived, true),
  ));

/** Canonical bin draw plus batch provenance, shared by parity and stock races. */
export async function seedFeedstockDraw(
  fixture: IntakeFixture, allocations: { feedstockId: string; wetMassUsedKg: number }[],
) {
  const org = fixture.ctx.organizationId;
  const [reactor] = await db.insert(reactors).values({
    organizationId: org, facilityId: fixture.facilityId,
    code: "R-FEEDSTOCK-SUITE", identifier: "Feedstock suite reactor", reactorType: "auger",
  }).returning();
  const wetMassKg = allocations.reduce((sum, allocation) => sum + allocation.wetMassUsedKg, 0);
  const [run] = await db.insert(productionRuns).values({
    organizationId: org, facilityId: fixture.facilityId, reactorId: reactor.id,
    code: "PR-FEEDSTOCK-SUITE", status: "complete",
    startTime: new Date("2026-10-06T10:00:00Z"), endTime: new Date("2026-10-06T11:00:00Z"),
    feedstockStorageLocationId: fixture.binId, feedstockWetMassKg: wetMassKg,
  }).returning();
  await db.insert(productionRunFeedstockDraws).values({
    organizationId: org, productionRunId: run.id, storageLocationId: fixture.binId, wetMassKg,
  });
  await db.insert(productionRunFeedstocks).values(allocations.map((allocation) => ({
    organizationId: org, productionRunId: run.id, ...allocation,
  })));
  return run;
}

export interface ApiProductionRunFixture extends ApiFeedstockFixture { reactorId: string; outputBinId: string }

/** Production tests share intake, credential and teardown setup with feedstocks. */
export async function createApiProductionRunFixture(label: string): Promise<ApiProductionRunFixture> {
  const fixture = await createApiFeedstockFixture(label, [
    "feedstocks:read", "feedstocks:write", "production-runs:read", "production-runs:write", "production-runs:delete", "reactors:read",
  ]);
  const reactorId = await addFixtureReactor(fixture, label);
  const [outputBin] = await db.insert(storageLocations).values({
    organizationId: fixture.ctx.organizationId, facilityId: fixture.facilityId,
    code: "OUT-1", name: "Output bin", type: "biochar_bin",
  }).returning({ id: storageLocations.id });
  return { ...fixture, reactorId, outputBinId: outputBin.id };
}

export function productionRunInput(fixture: ApiProductionRunFixture, withDraw = true) {
  return {
    facilityId: fixture.facilityId, reactorId: fixture.reactorId, status: "running" as const,
    startTime: PRODUCTION_RUN_FIXTURE_START_TIME, feedstockMoisturePercent: PRODUCTION_RUN_FIXTURE_MOISTURE_PERCENT,
    ...(withDraw ? { feedstockDraws: [{ storageLocationId: fixture.binId, wetMassKg: PRODUCTION_RUN_FIXTURE_DRAW_WET_KG }] } : {}),
  };
}
export function productionRunRequest(fixture: ApiFeedstockFixture, method: string, path = "", body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3100/api/v1/production-runs${path}`, {
    method, headers: { authorization: `Bearer ${fixture.key}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
