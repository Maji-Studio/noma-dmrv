import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  productionSamples, incidentReports, transportLegs, drivers, operators, activityEvents,
  creditBatches, creditBatchProductionRuns, creditBatchApplications, productionProcesses, feedstocks,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { runOperationInProcess } from "@/lib/operations/runner";
import { recordProductionSample } from "@/lib/operations/production-samples";
import { recordProductionIncident } from "@/lib/operations/production-incidents";
import { recordTransportLeg } from "@/lib/operations/transport-legs";
import { createDriver } from "@/lib/operations/drivers";
import { createOperator } from "@/lib/operations/operators";
import { createCreditBatch } from "@/lib/operations/credit-batches";
import { describeSavedCreditBatch } from "@/data-access/credit-batches";
import { cleanupOrderFixture, createOrderFixture, type OrderFixture } from "./helpers/order-operation-fixture";

const SUITE_TIMEOUT_MS = 60_000;
const EVENT_TIME = new Date("2026-09-09T10:00:00Z");
const MEASURED_WEIGHT_GRAMS = 100;
const DISTANCE_KM = 10;
const LOAD_MASS_KG = 100;
const fixtures: OrderFixture[] = [];
async function fixture() {
  const f = await createOrderFixture();
  fixtures.push(f);
  const [intake] = await db.select().from(feedstocks).where(eq(feedstocks.organizationId, f.ctx.organizationId));
  return { ...f, intake };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  for (const f of fixtures.splice(0).reverse()) {
    const org = f.ctx.organizationId;
    await db.delete(activityEvents).where(eq(activityEvents.organizationId, org));
    // Remove children added by these tests before the shared fixture's parents.
    await db.delete(productionSamples).where(eq(productionSamples.organizationId, org));
    await db.delete(incidentReports).where(eq(incidentReports.organizationId, org));
    await db.delete(transportLegs).where(eq(transportLegs.organizationId, org));
    await db.delete(drivers).where(eq(drivers.organizationId, org));
    await db.delete(operators).where(eq(operators.organizationId, org));
    await db.delete(creditBatchApplications).where(eq(creditBatchApplications.organizationId, org));
    await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.organizationId, org));
    await db.delete(creditBatches).where(eq(creditBatches.organizationId, org));
    await db.delete(productionProcesses).where(eq(productionProcesses.organizationId, org));
    await cleanupOrderFixture(f);
  }
});

const cases = [
  {
    name: "production samples", table: productionSamples,
    save: async (f: Fixture, ctx: OrgContext, intentKey: string) => {
      const row = await runOperationInProcess(recordProductionSample, ctx, {
        productionRunId: f.runs[0].id, timestamp: EVENT_TIME, weightGrams: MEASURED_WEIGHT_GRAMS,
      }, { intentKey });
      expect(row.timestamp).toBeInstanceOf(Date);
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.updatedAt).toBeInstanceOf(Date);
      return { id: row.id, result: row };
    },
  },
  {
    name: "production incidents", table: incidentReports,
    save: async (f: Fixture, ctx: OrgContext, intentKey: string) => {
      const row = await runOperationInProcess(recordProductionIncident, ctx, {
        productionRunId: f.runs[0].id, incidentTime: EVENT_TIME, severity: "low", description: "E2E intent incident",
      }, { intentKey });
      expect(row.incidentTime).toBeInstanceOf(Date);
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.updatedAt).toBeInstanceOf(Date);
      return { id: row.id, result: row };
    },
  },
  {
    name: "transport legs", table: transportLegs,
    save: async (f: Fixture, ctx: OrgContext, intentKey: string) => {
      const row = await runOperationInProcess(recordTransportLeg, ctx, {
        entityType: "feedstock", entityId: f.intake.id, distanceKm: DISTANCE_KM, distanceSource: "manual",
        loadMassKg: LOAD_MASS_KG, transportMethodType: "road", calculationMethodType: "distance_based", modelYear: null,
      }, { intentKey });
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.updatedAt).toBeInstanceOf(Date);
      return { id: row.id, result: row };
    },
  },
  {
    name: "drivers", table: drivers,
    save: async (_f: Fixture, ctx: OrgContext, intentKey: string) => {
      const row = await runOperationInProcess(createDriver, ctx, { name: "E2E Intent driver" }, { intentKey });
      return { id: row.id, result: row };
    },
  },
  {
    name: "operators", table: operators,
    save: async (_f: Fixture, ctx: OrgContext, intentKey: string) => {
      const row = await runOperationInProcess(createOperator, ctx, { name: "E2E Intent operator" }, { intentKey });
      return { id: row.id, result: row };
    },
  },
  {
    name: "credit batches", table: creditBatches,
    save: async (f: Fixture, ctx: OrgContext, intentKey: string) => {
      const committed = await runOperationInProcess(createCreditBatch, ctx, {
        facilityId: f.facility.id, feedstockTypeId: f.intake.feedstockTypeId,
        startDate: new Date("2026-09-01"), endDate: new Date("2026-09-30"),
        sampling: "sampled", productionRunIds: f.runs.map(run => run.id),
      }, { intentKey });
      expect(committed.batch.createdAt).toBeInstanceOf(Date);
      expect(committed.batch.updatedAt).toBeInstanceOf(Date);
      expect(committed.batch.startDate).toBe("2026-09-01");
      expect(committed.batch.endDate).toBe("2026-09-30");
      expect(committed.memberProductionRunIds.toSorted()).toEqual(f.runs.map(run => run.id).toSorted());
      // Exercise the same after-commit enrichment on first save and revived replay.
      const described = await describeSavedCreditBatch(ctx, committed);
      expect(described.id).toBe(committed.batch.id);
      expect(described.productionRunIds.toSorted()).toEqual(committed.memberProductionRunIds.toSorted());
      expect(described.previewAvailable).toEqual(expect.any(Boolean));
      return { id: committed.batch.id, result: committed };
    },
  },
];

describe.each(cases)("$name app create intents", ({ table, save }) => {
  const rows = (f: Fixture) => db.select({ id: table.id }).from(table).where(eq(table.organizationId, f.ctx.organizationId));
  it("replays the same result and saves exactly one row", { timeout: SUITE_TIMEOUT_MS }, async () => {
    const f = await fixture();
    const key = randomUUID();
    const first = await save(f, f.ctx, key);
    const activity = await db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId)).orderBy(activityEvents.id);
    expect(await save(f, f.ctx, key)).toEqual(first);
    expect(await db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId)).orderBy(activityEvents.id)).toEqual(activity);
    expect(await rows(f)).toEqual([{ id: first.id }]);
  });
  it("isolates the same user's intent key across organizations", { timeout: SUITE_TIMEOUT_MS }, async () => {
    const firstOrg = await fixture();
    const secondOrg = await fixture();
    const secondContext = { ...secondOrg.ctx, userId: firstOrg.ctx.userId };
    const key = randomUUID();
    const first = await save(firstOrg, firstOrg.ctx, key);
    const second = await save(secondOrg, secondContext, key);
    expect(second.id).not.toBe(first.id);
    expect(await rows(firstOrg)).toEqual([{ id: first.id }]);
    expect(await rows(secondOrg)).toEqual([{ id: second.id }]);
    expect(await save(secondOrg, secondContext, key)).toEqual(second);
  });
});
