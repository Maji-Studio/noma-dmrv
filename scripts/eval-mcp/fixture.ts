import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities, feedstocks, feedstockTypes, members, storageLocations, suppliers, users, apiAuditEvents, reactors, productionRuns, productionRunFeedstockDraws } from "@/db/schema";
import { createApiKey } from "@/data-access/api-keys";
import { deriveFeedstockWetStockKg } from "@/data-access/feedstock-wet-stock";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { formatFacilityDate } from "@/lib/date-utils";
import { logFeedstockDelivery } from "@/lib/operations/feedstocks";
import { startProductionRun } from "@/lib/operations/production-runs";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { addFixtureReactor, createIntakeFixture, removeIntakeFixture, type IntakeFixture } from "../../tests/helpers/operation-fixture";
import { BIN_CODES, FACILITY_TIME_ZONE, TARGET_BIN_CODE, TARGET_REACTOR_CODE } from "./config";
import { caseTwoExpectation, type DatabaseSnapshot, type Target } from "./score";

const INTAKE_SCOPES = ["feedstocks:read", "feedstocks:write", "facilities:read", "suppliers:read",
  "feedstock-types:read", "storage-locations:read", "vehicles:read", "drivers:read", "production-runs:read", "production-runs:write", "reactors:read"];

export interface EvalFixture extends IntakeFixture {
  key: string;
  reactorId: string;
  bins: { id: string; beforeWetKg: number }[];
}

/** Test-only provisioning reuses the operation fixture, never a dev organization. */
export async function seedFixture(caseId: string): Promise<EvalFixture> {
  // Roll back a partially created organization if any prerequisite insert fails.
  const fixture = await db.transaction((tx) => createIntakeFixture(`eval-${caseId}-${randomUUID()}`, tx));
  const org = fixture.ctx.organizationId;
  try {
    await db.insert(users).values({ id: fixture.ctx.userId, email: `${fixture.ctx.userId}@example.test`, name: "MCP evaluation", emailVerified: true });
    await db.insert(members).values({ id: randomUUID(), organizationId: org, userId: fixture.ctx.userId, role: "owner" });
    await db.update(facilities).set({ timezone: FACILITY_TIME_ZONE, archivedAt: null })
      .where(and(eq(facilities.organizationId, org), eq(facilities.id, fixture.facilityId)));
    await db.update(suppliers).set({ name: "X Timber", code: "X" })
      .where(and(eq(suppliers.organizationId, org), eq(suppliers.id, fixture.supplierId)));
    await db.insert(suppliers).values({ organizationId: org, code: "Y", name: "Y Sawmill" });
    await db.update(feedstockTypes).set({ name: "Wood chips", code: "WOOD" })
      .where(and(eq(feedstockTypes.organizationId, org), eq(feedstockTypes.id, fixture.feedstockTypeId)));
    await db.insert(feedstockTypes).values({ organizationId: org, code: "RICE", name: "Rice husks", category: "agricultural", usage: "pyrolysis" });
    await db.update(storageLocations).set({ code: TARGET_BIN_CODE, name: TARGET_BIN_CODE, feedstockTypeId: fixture.feedstockTypeId })
      .where(and(eq(storageLocations.organizationId, org), eq(storageLocations.id, fixture.binId)));
    await db.insert(storageLocations).values(BIN_CODES.filter((code) => code !== TARGET_BIN_CODE).map((code) => ({
      organizationId: org, facilityId: fixture.facilityId, code, name: code, type: "feedstock_bin" as const, feedstockTypeId: fixture.feedstockTypeId,
    })));
    const reactorId = await addFixtureReactor(fixture, caseId);
    await db.update(reactors).set({ code: TARGET_REACTOR_CODE })
      .where(and(eq(reactors.organizationId, org), eq(reactors.id, reactorId)));
    const bins = await db.select({ id: storageLocations.id }).from(storageLocations).where(eq(storageLocations.organizationId, org));
    const baseline = await Promise.all(bins.map(async (bin) => ({ ...bin, beforeWetKg: await deriveFeedstockWetStockKg(fixture.ctx, db, bin.id) })));
    const credential = await createApiKey(fixture.ctx, { name: "MCP evaluation", scopes: INTAKE_SCOPES, expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS });
    return { ...fixture, reactorId, key: credential.key, bins: baseline };
  } catch {
    await cleanupFixture(fixture);
    throw new Error(`Could not seed evaluation organization ${org}. Check the test database schema and auth configuration.`);
  }
}

export function evaluationExpectation() {
  return caseTwoExpectation(toOperationJsonSchema(logFeedstockDelivery.input));
}

/** Omitted required run inputs must be available from grounding, never invented. */
export function evaluationRunRequirements(): string[] {
  const contract = toOperationJsonSchema(startProductionRun.input);
  return Array.isArray(contract.required) ? contract.required as string[] : [];
}

export function fixtureTarget(fixture: EvalFixture, now: Date): Target {
  return { supplierId: fixture.supplierId, feedstockTypeId: fixture.feedstockTypeId,
    facilityId: fixture.facilityId, binId: fixture.binId, reactorId: fixture.reactorId, timeZone: FACILITY_TIME_ZONE, today: formatFacilityDate(now, FACILITY_TIME_ZONE) };
}

/** The oracle reads all feedstocks and bins in this fixture organization. */
export async function readSnapshot(fixture: EvalFixture): Promise<DatabaseSnapshot> {
  const org = fixture.ctx.organizationId;
  const rows = await db.select({ supplierId: feedstocks.supplierId, feedstockTypeId: feedstocks.feedstockTypeId,
    facilityId: feedstocks.facilityId, storageLocationId: feedstocks.storageLocationId,
    massWetKg: feedstocks.massWetKg, moistureContentPercent: feedstocks.moistureContentPercent, deliveryDate: feedstocks.deliveryDate,
  }).from(feedstocks).where(eq(feedstocks.organizationId, org));
  const bins = await db.select({ id: storageLocations.id }).from(storageLocations).where(eq(storageLocations.organizationId, org));
  return {
    feedstocks: rows.map((row) => ({ ...row, deliveryDate: row.deliveryDate?.toISOString().split("T")[0] ?? null })),
    bins: await Promise.all(bins.map(async (bin) => ({ ...bin,
      beforeWetKg: fixture.bins.find((baseline) => baseline.id === bin.id)?.beforeWetKg ?? 0,
      afterWetKg: await deriveFeedstockWetStockKg(fixture.ctx, db, bin.id),
    }))),
    runs: (await db.select({ id: productionRuns.id, facilityId: productionRuns.facilityId,
      reactorId: productionRuns.reactorId, status: productionRuns.status, startTime: productionRuns.startTime,
    }).from(productionRuns).where(eq(productionRuns.organizationId, org)))
      .map((run) => ({ ...run, startTime: run.startTime.toISOString() })),
    draws: await db.select({ productionRunId: productionRunFeedstockDraws.productionRunId,
      storageLocationId: productionRunFeedstockDraws.storageLocationId, wetMassKg: productionRunFeedstockDraws.wetMassKg,
    }).from(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.organizationId, org)),
    audits: await db.select({ transport: apiAuditEvents.transport, operationId: apiAuditEvents.operationId }).from(apiAuditEvents).where(eq(apiAuditEvents.organizationId, org)),
  };
}

export async function cleanupFixture(fixture: IntakeFixture): Promise<void> {
  // The helper removes domain rows first; bookkeeping and credentials cascade with the organization.
  await removeIntakeFixture(fixture);
  await db.delete(users).where(eq(users.id, fixture.ctx.userId));
}
