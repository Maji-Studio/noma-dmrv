/** Real PostgreSQL query tests in session-local TEMP tables, always rolled back.
 * Same harness as delivery-allocation-provenance.integration.test.ts.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import * as schema from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { NO_APPLICATION_YET_WARNING } from "@/lib/chain-of-custody/copy";
import { getCreditBatchChainData } from "./chain-of-custody-batch";

const url = process.env.DATABASE_URL;
const CONNECTION_TIMEOUT_MS = 1_000;
const probe = new Client({ connectionString: url, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS });
const available = await probe.connect().then(() => true, () => false);
await probe.end();
if (!available && process.env.CI) throw new Error("Roll-forward tests require PostgreSQL in CI");
const ctx: OrgContext = { organizationId: "roll-forward-org", userId: "roll-forward-user", orgRole: "owner", isPlatformAdmin: false };
const ids = Object.fromEntries(["formulation", "facility", "bin", "run", "outsideRun", "shipped", "stocked", "foreign", "legacy", "delivery", "order", "batch"].map(key => [key, randomUUID()]));
const org = { organizationId: ctx.organizationId };
let client: Client;
let executor: typeof db;

// No persistent DDL and no migrations: shadow just the tables exercised here.
const tables: PgTable[] = [schema.applications, schema.applicationOutputAllocations, schema.biocharProducts,
  schema.biocharProductSourceAllocations, schema.deliveries, schema.orders, schema.outputStockAllocations,
  schema.outputStockRunAllocations, schema.productionRuns, schema.creditBatchApplications,
  schema.creditBatchProductionRuns, schema.creditBatches, schema.facilities, schema.feedstockTypes,
  schema.formulations, schema.reactors, schema.storageLocations, schema.productionRunFeedstocks,
  schema.feedstocks, schema.feedstockDeliveries, schema.suppliers];
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

describe.skipIf(!available)("run roll-forward PostgreSQL queries", () => {
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
    const tx = executor as unknown as DbTransaction;
    vi.spyOn(db, "transaction").mockImplementation(async callback => callback(tx));
    vi.spyOn(db, "select").mockImplementation(executor.select.bind(executor));

    await executor.insert(schema.facilities).values({ ...org, id: ids.facility, code: "F", name: "Fixture" });
    await executor.insert(schema.storageLocations).values({ ...org, id: ids.bin, facilityId: ids.facility, code: "BIN", name: "Fixture bin", type: "product_bin" });
    // `outsideRun` is not a batch member but shares the shipped product layer.
    await executor.insert(schema.productionRuns).values(["run", "outsideRun"].map(key => ({ ...org, id: ids[key], facilityId: ids.facility, code: key, reactorId: randomUUID(), status: "complete" as const, biocharDryMassKg: 1000 })));
    await executor.insert(schema.formulations).values({ ...org, id: ids.formulation, code: "FORM", name: "Fixture pure", biocharRatio: 1 });
    await executor.insert(schema.biocharProducts).values(["shipped", "stocked", "foreign"].map(label => ({ ...org, id: ids[label], facilityId: ids.facility, code: label, formulationId: ids.formulation, placedAt: new Date("2026-01-01T12:00:00.000Z"), productionDate: new Date("2026-01-01"), massKg: 600 })));
    // A legacy lot: no source bin, no allocation row, linked to the run directly.
    await executor.insert(schema.biocharProducts).values({ ...org, id: ids.legacy, facilityId: ids.facility, code: "legacy", formulationId: ids.formulation, placedAt: new Date("2026-01-01T12:00:00.000Z"), productionDate: new Date("2026-01-01"), massKg: 200, moistureContentPercent: 10, linkedProductionRunId: ids.run });
    await executor.insert(schema.biocharProductSourceAllocations).values([
      { ...org, biocharProductId: ids.shipped, productionRunId: ids.run, sourceStorageLocationId: ids.bin, allocatedWetMassKg: 600, allocatedDryMassKg: 570 },
      { ...org, biocharProductId: ids.stocked, productionRunId: ids.run, sourceStorageLocationId: ids.bin, allocatedWetMassKg: 300, allocatedDryMassKg: 285 },
      // Another tenant's allocation row: only its org filter keeps it out, since
      // the product it names exists in this org.
      { organizationId: "other-org", biocharProductId: ids.foreign, productionRunId: ids.run, sourceStorageLocationId: ids.bin, allocatedWetMassKg: 1, allocatedDryMassKg: 1 },
    ]);
    await executor.execute(sql`insert into orders (organization_id, id, facility_id, formulation_id, code, order_date, quantity_kg) values (${ctx.organizationId}, ${ids.order}, ${ids.facility}, ${ids.formulation}, 'O', '2026-01-02', 400)`);
    await executor.insert(schema.deliveries).values({ ...org, id: ids.delivery, facilityId: ids.facility, code: "D", orderId: ids.order, deliveryDate: new Date("2026-01-03"), status: "delivered", storageLocationId: ids.bin, deliveredWetMassKg: 400, massDryKg: 380 });
    // Original + reversal + replacement: the delivery nets to one shipment,
    // 285 kg dry from the member run and 95 kg dry from the outside run.
    for (const [dry, wet] of [[380, 400], [-380, -400], [380, 400]] as const) {
      const allocationId = randomUUID();
      await executor.insert(schema.outputStockAllocations).values({ ...org, id: allocationId, movementId: randomUUID(), sourceStorageLocationId: ids.bin, biocharProductId: ids.shipped, deliveryId: ids.delivery, dryMassKg: String(dry), wetMassKg: String(wet), basisSnapshot: {} });
      await executor.insert(schema.outputStockRunAllocations).values([
        { ...org, allocationId, productionRunId: ids.run, dryMassKg: String(dry * 0.75) },
        { ...org, allocationId, productionRunId: ids.outsideRun, dryMassKg: String(dry * 0.25) },
      ]);
    }
    await executor.insert(schema.creditBatches).values({ ...org, id: ids.batch, facilityId: ids.facility, code: "CB", feedstockTypeId: randomUUID(), productionProcessId: randomUUID(), startDate: "2026-01-01", endDate: "2026-01-02" });
    await executor.insert(schema.creditBatchProductionRuns).values({ ...org, creditBatchId: ids.batch, productionRunId: ids.run });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (client) { await client.query("rollback"); await client.end(); }
  });

  it("traces an unapplied member run forward to its products and its share of the delivery", async () => {
    const data = await getCreditBatchChainData(ctx, ids.batch);

    expect(data.lineages).toEqual([]);
    expect(data.warnings).toEqual([NO_APPLICATION_YET_WARNING]);
    expect(data.facility.id).toBe(ids.facility);
    expect(data.rollForwards).toHaveLength(1);
    const [rollForward] = data.rollForwards;
    expect(rollForward.source.productionRun.id).toBe(ids.run);
    expect(rollForward.products.map(p => [p.product.id, p.drawnWetMassKg, p.drawnDryMassKg])).toEqual([
      [ids.legacy, 200, 180],
      [ids.shipped, 600, 570],
      [ids.stocked, 300, 285],
    ]);
    const [, shipped, stocked] = rollForward.products;
    // Only the member run's share, never the outside run's biochar.
    expect(shipped.deliveries.map(d => [d.delivery.id, d.wetMassKg, d.dryMassKg])).toEqual([[ids.delivery, 300, 285]]);
    expect(shipped.deliveries[0].delivery.deliveredWetMassKg).toBe(400);
    expect(stocked.deliveries).toEqual([]);
  });
});
