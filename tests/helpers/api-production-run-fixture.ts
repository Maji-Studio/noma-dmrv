import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { db } from "@/db";
import { apiAuditEvents, apiIdempotencyRecords, productionRunFeedstockDraws, productionRunFeedstocks, productionRuns } from "@/db/schema";
import { getOutputBinStocks } from "@/data-access/output-stock";
import { GET, PATCH, DELETE } from "@/app/api/v1/production-runs/[idOrCode]/route";
import { POST } from "@/app/api/v1/production-runs/route";
import { productionRunRepresentationSchema, type ProductionRunRepresentation } from "@/lib/representations/production-runs";
import { PRODUCTION_RUN_FIXTURE_DRAW_WET_KG, binWetStock, productionRunInput, productionRunRequest, requiredEtag, type ApiProductionRunFixture } from "./api-feedstock-fixture";

export const RUN_INTAKE_WET_KG = 4200;
export const RUN_DRAW_WET_KG = PRODUCTION_RUN_FIXTURE_DRAW_WET_KG;
export const RUN_OUTPUT_WET_KG = 200;
export const RUN_OUTPUT_MOISTURE_PERCENT = 2;
export const RUN_OUTPUT_DRY_KG = 196;
export const INITIAL_RUN_VERSION = 1;
export const NEXT_RUN_VERSION = 2;
export const RUN_END_TIME = "2026-10-06T11:00:00Z";
const params = (idOrCode: string) => ({ params: Promise.resolve({ idOrCode }) });

export const postProductionRun = (fixture: ApiProductionRunFixture, body: unknown = productionRunInput(fixture), key = randomUUID()) =>
  POST(productionRunRequest(fixture, "POST", "", body, { "idempotency-key": key }));
export const getProductionRun = (fixture: ApiProductionRunFixture, id: string) =>
  GET(productionRunRequest(fixture, "GET", `/${id}`), params(id));
export const patchProductionRun = (fixture: ApiProductionRunFixture, row: Pick<ProductionRunRepresentation, "id">, etag: string, body: unknown) =>
  PATCH(productionRunRequest(fixture, "PATCH", `/${row.id}`, body, { "if-match": etag }), params(row.id));
export const deleteProductionRun = (fixture: ApiProductionRunFixture, row: Pick<ProductionRunRepresentation, "id">, etag: string) =>
  DELETE(productionRunRequest(fixture, "DELETE", `/${row.id}`, undefined, { "if-match": etag }), params(row.id));

export async function readProductionRun(fixture: ApiProductionRunFixture, id: string) {
  const response = await getProductionRun(fixture, id);
  expect(response.status).toBe(200);
  return { row: productionRunRepresentationSchema.parse((await response.json()).data), etag: requiredEtag(response) };
}
export async function seedApiProductionRun(fixture: ApiProductionRunFixture, body: unknown = productionRunInput(fixture)) {
  const response = await postProductionRun(fixture, body);
  expect(response.status).toBe(201);
  return { row: productionRunRepresentationSchema.parse((await response.json()).data), etag: requiredEtag(response) };
}
export const completionPatch = (fixture: ApiProductionRunFixture) => ({
  status: "complete" as const, endTime: RUN_END_TIME, biocharOutputKg: RUN_OUTPUT_WET_KG,
  biocharMoisturePercent: RUN_OUTPUT_MOISTURE_PERCENT, biocharStorageLocationId: fixture.outputBinId,
});
export const cancellationPatch = { status: "cancelled" as const, endTime: RUN_END_TIME, cancellationReason: "Reactor stopped" };

/** Read actual rows and stock independently of the API's projection. */
export async function captureProductionRunState(fixture: ApiProductionRunFixture) {
  const org = fixture.ctx.organizationId;
  return {
    runs: await db.select().from(productionRuns).where(eq(productionRuns.organizationId, org)),
    draws: await db.select().from(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.organizationId, org)),
    allocations: await db.select().from(productionRunFeedstocks).where(eq(productionRunFeedstocks.organizationId, org)),
    wetStock: await binWetStock(fixture),
    outputStock: (await getOutputBinStocks(fixture.ctx, [fixture.outputBinId])).get(fixture.outputBinId),
  };
}

/** Replay equivalent commands against the same prerequisites and ids. */
export async function restoreProductionRunState(fixture: ApiProductionRunFixture, state: Awaited<ReturnType<typeof captureProductionRunState>>) {
  const org = fixture.ctx.organizationId;
  await db.transaction(async (tx) => {
    await tx.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.organizationId, org));
    await tx.delete(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.organizationId, org));
    await tx.delete(productionRuns).where(eq(productionRuns.organizationId, org));
    if (state.runs.length) await tx.insert(productionRuns).values(state.runs);
    if (state.draws.length) await tx.insert(productionRunFeedstockDraws).values(state.draws);
    if (state.allocations.length) await tx.insert(productionRunFeedstocks).values(state.allocations);
    await tx.delete(apiAuditEvents).where(eq(apiAuditEvents.organizationId, org));
    await tx.delete(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, org));
  });
}

export async function productionRunAudits(fixture: ApiProductionRunFixture) {
  return (await db.select().from(apiAuditEvents).where(eq(apiAuditEvents.organizationId, fixture.ctx.organizationId)))
    .filter((event) => event.entityType === "productionRun");
}
