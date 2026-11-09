/** Real PostgreSQL queries against session-local TEMP tables, rolled back. */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, type DbTransaction } from "@/db";
import * as schema from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { TEST_SITE_POSITION } from "../../tests/helpers/test-org";
import { getDashboardBatchScope } from "./dashboard-batch-scope";

const CONNECTION_TIMEOUT_MS = 1_000;
const url = process.env.DATABASE_URL;
const probe = new Client({ connectionString: url, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS });
const available = await probe.connect().then(() => true, () => false);
await probe.end();
if (!available && process.env.CI) throw new Error("Dashboard batch scope tests require PostgreSQL in CI");

const ctx: OrgContext = { organizationId: "dashboard-scope-org", userId: "dashboard-scope-user", orgRole: "admin", isPlatformAdmin: false };
const OTHER_ORG = "dashboard-scope-other-org";
const org = { organizationId: ctx.organizationId };
const ids = Object.fromEntries([
  "facility", "otherFacility", "emptyFacility", "batchA", "batchB", "otherFacilityBatch", "foreignBatch",
  "runA", "runB", "outsideRun", "foreignRun", "feedstock", "supplier", "product", "stockedProduct",
  "delivery", "application", "order", "reactor", "outputBin", "productBin", "formulation",
].map(key => [key, randomUUID()]));

// Shadow every table used by the accounting loader, including its subqueries.
const tables: PgTable[] = [
  schema.creditBatches, schema.creditBatchProductionRuns, schema.creditBatchApplications,
  schema.facilities, schema.feedstockTypes, schema.productionRuns, schema.productionRunFeedstocks,
  schema.feedstocks, schema.suppliers, schema.reactors, schema.storageLocations,
  schema.applications, schema.applicationOutputAllocations, schema.deliveries, schema.orders,
  schema.customerLocations, schema.biocharProducts, schema.formulations,
  schema.biocharProductSourceAllocations, schema.outputStockAllocations, schema.outputStockRunAllocations,
  schema.binMovements, schema.documents, schema.samples, schema.certifierProjects,
];
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
let client: Client;
let executor: typeof db;

describe.skipIf(!available)("dashboard batch scope PostgreSQL queries", () => {
  beforeEach(async () => {
    client = new Client({ connectionString: url, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS });
    await client.connect();
    await client.query("begin");
    for (const table of tables) {
      const config = getTableConfig(table);
      const columns = config.columns.map(column => `${quote(column.name)} ${column.columnType === "PgEnumColumn" ? "text" : column.getSQLType()}${column.name === "id" ? " default gen_random_uuid()" : ""}`);
      await client.query(`create temporary table ${quote(config.name)} (${columns.join(", ")}) on commit drop`);
    }
    executor = drizzle(client, { schema }) as unknown as typeof db;
    vi.spyOn(db, "transaction").mockImplementation(async callback => callback(executor as unknown as DbTransaction));
    vi.spyOn(db, "select").mockImplementation(executor.select.bind(executor));

    await executor.insert(schema.facilities).values(["facility", "otherFacility", "emptyFacility"].map(key => ({
      ...TEST_SITE_POSITION, ...org, id: ids[key], code: key, name: "Fixture", timezone: "UTC",
    })));
    await executor.insert(schema.creditBatches).values([
      ["batchA", "facility", ctx.organizationId], ["batchB", "facility", ctx.organizationId],
      ["otherFacilityBatch", "otherFacility", ctx.organizationId],
      // Deliberately points to the caller's facility in a relaxed TEMP table:
      // facility-only filtering would leak this tenant's batch.
      ["foreignBatch", "facility", OTHER_ORG],
    ].map(([key, facility, organizationId]) => ({
      organizationId, id: ids[key], facilityId: ids[facility], code: key,
      feedstockTypeId: randomUUID(), productionProcessId: randomUUID(),
      startDate: "2026-01-01", endDate: "2026-01-31",
    })));
    await executor.insert(schema.productionRuns).values([
      ["runA", "facility", ctx.organizationId], ["runB", "facility", ctx.organizationId],
      ["outsideRun", "otherFacility", ctx.organizationId], ["foreignRun", "facility", OTHER_ORG],
    ].map(([key, facility, organizationId]) => ({
      organizationId, id: ids[key], facilityId: ids[facility], code: key,
      reactorId: ids.reactor, startTime: new Date("2026-01-01T08:00:00Z"), status: "complete" as const,
      biocharStorageLocationId: ids.outputBin, biocharMoisturePercent: 0,
      feedstockMassDryKg: key === "runA" ? 2_000 : 1_000, biocharDryMassKg: 500, biocharOutputKg: 500,
    })));
    await executor.insert(schema.creditBatchProductionRuns).values([
      ["batchA", "runA", ctx.organizationId], ["batchB", "runA", ctx.organizationId],
      ["batchB", "runB", ctx.organizationId], ["otherFacilityBatch", "outsideRun", ctx.organizationId],
      ["foreignBatch", "foreignRun", OTHER_ORG],
      // A corrupt cross-tenant child naming a visible batch must also stay out.
      ["batchA", "foreignRun", OTHER_ORG],
    ].map(([batch, run, organizationId]) => ({ organizationId, creditBatchId: ids[batch], productionRunId: ids[run] })));
    await executor.insert(schema.suppliers).values({ ...org, id: ids.supplier, code: "S", name: "Fixture" });
    await executor.insert(schema.feedstocks).values({
      ...org, id: ids.feedstock, facilityId: ids.facility, code: "FS", supplierId: ids.supplier,
      feedstockTypeId: randomUUID(), deliveryDate: new Date("2026-01-01"),
      massWetKg: 200, massDryKg: 200, moistureContentPercent: 0, storageLocationId: ids.outputBin,
    });
    await executor.insert(schema.productionRunFeedstocks).values(["runA", "runB"].map(key => ({
      ...org, productionRunId: ids[key], feedstockId: ids.feedstock, wetMassUsedKg: 100,
    })));
    await executor.insert(schema.biocharProducts).values(["product", "stockedProduct"].map(key => ({
      ...org, id: ids[key], facilityId: ids.facility, code: key, productionDate: "2026-01-01",
      formulationId: ids.formulation, massKg: 100, moistureContentPercent: 0, waterAddedKg: 0,
      placedAt: new Date("2026-01-01T12:00:00Z"), storageLocationId: ids.productBin,
      sourceBiocharStorageLocationId: ids.outputBin,
    })));
    await executor.insert(schema.biocharProductSourceAllocations).values({
      ...org, biocharProductId: ids.stockedProduct, productionRunId: ids.runA,
      sourceStorageLocationId: ids.outputBin, allocatedWetMassKg: 100, allocatedDryMassKg: 100,
    });
    await executor.insert(schema.deliveries).values({
      ...org, id: ids.delivery, facilityId: ids.facility, code: "D", orderId: ids.order,
      deliveryDate: new Date("2026-01-02"), storageLocationId: ids.productBin, deliveredWetMassKg: 100, massDryKg: 100,
    });
    await executor.insert(schema.applications).values({
      ...org, id: ids.application, code: "A", deliveryId: ids.delivery,
      applicationDate: new Date("2026-01-03"), evidenceMethod: "location", fieldSizeHa: 1,
      biocharAppliedTons: 0.1, biocharAppliedDryTons: 0.1,
    });
    await executor.insert(schema.applicationOutputAllocations).values({
      ...org, applicationId: ids.application, deliveryId: ids.delivery, biocharProductId: ids.product,
      productionRunId: ids.runA, wetMassKg: "100", dryMassKg: "100",
    });
    await executor.insert(schema.creditBatchApplications).values(["batchA", "batchB"].map(key => ({
      ...org, creditBatchId: ids[key], applicationId: ids.application, allocatedWetMassKg: 100, allocatedDryMassKg: 100,
    })));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (client) { await client.query("rollback"); await client.end(); }
  });

  it("refuses another org's batch and never counts another org's batches or child rows", async () => {
    await expect(getDashboardBatchScope(ctx, ids.facility, ids.foreignBatch)).rejects.toThrow("Credit batch was not found.");
    const all = await getDashboardBatchScope(ctx, ids.facility, null);
    expect(all.batchIds.sort()).toEqual([ids.batchA, ids.batchB].sort());
    expect(all.stationTotals.production).toBe(2);
    expect(all.recordIds).not.toContain(ids.foreignBatch);
    expect(all.recordIds).not.toContain(ids.foreignRun);
    expect((await getDashboardBatchScope({ ...ctx, organizationId: OTHER_ORG }, ids.facility, null)).batchIds).toEqual([ids.foreignBatch]);
  });

  it("refuses another facility's batch and keeps all-batch scope within the facility", async () => {
    await expect(getDashboardBatchScope(ctx, ids.facility, ids.otherFacilityBatch)).rejects.toThrow("Credit batch was not found.");
    const all = await getDashboardBatchScope(ctx, ids.facility, null);
    expect(all.recordIds).not.toContain(ids.outsideRun);
    expect((await getDashboardBatchScope(ctx, ids.otherFacility, null)).batchIds).toEqual([ids.otherFacilityBatch]);
  });

  it("unions all batches while counting a shared run, feedstock and application once", async () => {
    const single = await getDashboardBatchScope(ctx, ids.facility, ids.batchA);
    const all = await getDashboardBatchScope(ctx, ids.facility, null);
    expect(single.stationTotals).toEqual({ suppliers: 1, feedstock: 1, production: 1, products: 2, deliveries: 1, applications: 1 });
    expect(all.stationTotals).toEqual({ ...single.stationTotals, production: 2 });
    expect(single.kpis.feedstockProcessedDryTonnes).toBe(2);
    // The application has a 0.1 t slice in each batch: it counts once, its applied mass is both slices.
    expect(all.kpis).toEqual({ feedstockProcessedDryTonnes: 3, biocharProducedDryTonnes: 1, appliedToSoilDryTonnes: 0.2, co2eStoredTonnes: null });
    expect(all.recordIds).toEqual([...new Set([...single.recordIds, ids.batchB, ids.runB])].sort());
  });

  it("leaves archived batches out of all credit batches, as the batch filter does", async () => {
    await executor.update(schema.creditBatches).set({ archivedAt: new Date() }).where(eq(schema.creditBatches.id, ids.batchB));
    const all = await getDashboardBatchScope(ctx, ids.facility, null);
    expect(all.batchIds).toEqual([ids.batchA]);
    expect(all.recordIds).not.toContain(ids.runB);
  });

  it("returns the empty-facility contract and refuses a missing selected batch", async () => {
    const empty = await getDashboardBatchScope(ctx, ids.emptyFacility, null);
    expect(Object.values(empty.stationTotals)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(empty.kpis).toEqual({ feedstockProcessedDryTonnes: null, biocharProducedDryTonnes: null, appliedToSoilDryTonnes: 0, co2eStoredTonnes: null });
    expect(empty.batchIds).toEqual([]);
    expect(empty.recordIds).toEqual([]);
    await expect(getDashboardBatchScope(ctx, ids.facility, randomUUID())).rejects.toThrow("Credit batch was not found.");
  });
});
