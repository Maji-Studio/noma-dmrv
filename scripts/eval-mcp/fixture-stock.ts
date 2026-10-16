import { apiActivityWhere } from "../../tests/helpers/api-activity";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents, binMovements, facilities, members, outputStockAllocations, outputStockMoistureReadings,
  outputStockRunAllocations, productionRuns, storageLocations, users,
} from "@/db/schema";
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { addFixtureReactor, createIntakeFixture, type IntakeFixture } from "../../tests/helpers/operation-fixture";
import { cleanupFixture } from "./fixture";
import { FACILITY_TIME_ZONE, STOCK_BIN_CODE, STOCK_RUNS, STOCK_TARGET_RUN_CODE } from "./config";
import type { StockDatabaseSnapshot, StockTarget } from "./score-stock";

const STOCK_SCOPES = ["biochar-products:read", "biochar-products:write", "storage-locations:read",
  "facilities:read", "production-runs:read"];

export interface StockEvalFixture extends IntakeFixture { key: string; target: StockTarget }

/** Seed upstream facts only: a split biochar bin with two completed run layers and no stock movements. */
export async function seedStockFixture(caseId: string): Promise<StockEvalFixture> {
  const fixture = await db.transaction((tx) => createIntakeFixture(`eval-${caseId}-${randomUUID()}`, tx));
  const org = fixture.ctx.organizationId;
  try {
    await db.insert(users).values({ id: fixture.ctx.userId, email: `${fixture.ctx.userId}@example.test`, name: "MCP evaluation", emailVerified: true });
    await db.insert(members).values({ id: randomUUID(), organizationId: org, userId: fixture.ctx.userId, role: "owner" });
    await db.update(facilities).set({ timezone: FACILITY_TIME_ZONE, archivedAt: null })
      .where(and(eq(facilities.organizationId, org), eq(facilities.id, fixture.facilityId)));
    const [bin] = await db.insert(storageLocations).values({ organizationId: org, facilityId: fixture.facilityId,
      code: STOCK_BIN_CODE, name: STOCK_BIN_CODE, type: "biochar_bin", stockMode: "split" }).returning({ id: storageLocations.id });
    const reactorId = await addFixtureReactor(fixture, caseId);
    const runs = await db.insert(productionRuns).values(STOCK_RUNS.map((run) => ({
      organizationId: org, facilityId: fixture.facilityId, reactorId, code: run.code, status: "complete" as const,
      startTime: new Date(run.start), endTime: new Date(run.end), biocharStorageLocationId: bin.id,
      biocharOutputKg: run.wetKg, biocharMoisturePercent: run.moisturePercent, biocharDryMassKg: run.dryKg,
    }))).returning({ id: productionRuns.id, code: productionRuns.code });
    const targetRun = runs.find((run) => run.code === STOCK_TARGET_RUN_CODE);
    if (!targetRun) throw new Error("Stock evaluation target run was not seeded.");
    const credential = await createApiKey(fixture.ctx, { name: "MCP evaluation", scopes: STOCK_SCOPES, expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS });
    return { ...fixture, key: credential.key, target: { binId: bin.id, layerId: targetRun.id } };
  } catch {
    await cleanupStockFixture(fixture);
    throw new Error(`Could not seed stock evaluation organization ${org}. Check the test database schema and auth configuration.`);
  }
}

/** Read every movement, allocation and write audit in the isolated organization. */
export async function readStockSnapshot(fixture: StockEvalFixture): Promise<StockDatabaseSnapshot> {
  const org = fixture.ctx.organizationId;
  const [movements, allocations, audits] = await Promise.all([
    db.select({ id: binMovements.id, binId: binMovements.storageLocationId, kind: binMovements.outputKind, input: binMovements.inputSnapshot })
      .from(binMovements).where(eq(binMovements.organizationId, org)),
    db.select({ movementId: outputStockAllocations.movementId, binId: outputStockAllocations.sourceStorageLocationId,
      layerId: outputStockAllocations.productionRunId, wetMassKg: outputStockAllocations.wetMassKg })
      .from(outputStockAllocations).where(eq(outputStockAllocations.organizationId, org)),
    db.select({ transport: activityEvents.source, operationId: sql<string>`${activityEvents.operationId}` })
      .from(activityEvents).where(apiActivityWhere(org)),
  ]);
  return { movements, allocations: allocations.map((row) => ({ ...row, wetMassKg: row.wetMassKg === null ? null : Number(row.wetMassKg) })), audits };
}

export async function cleanupStockFixture(fixture: IntakeFixture): Promise<void> {
  const org = fixture.ctx.organizationId;
  await db.delete(outputStockRunAllocations).where(eq(outputStockRunAllocations.organizationId, org));
  await db.delete(outputStockMoistureReadings).where(eq(outputStockMoistureReadings.organizationId, org));
  await db.delete(outputStockAllocations).where(eq(outputStockAllocations.organizationId, org));
  await db.delete(binMovements).where(eq(binMovements.organizationId, org));
  await cleanupFixture(fixture);
}
