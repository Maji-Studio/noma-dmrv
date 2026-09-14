/** Real PostgreSQL query tests in session-local TEMP tables, always rolled back.
 * These verify consumer SQL, not the conductor's combined migration/FKs.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { and, eq, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import * as schema from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { getDeliveryAllocationProvenance, saveApplicationOutputAllocations } from "./delivery-allocation-provenance";
import { reconcileUnassignedCreditBatchApplicationSlices } from "./credit-batch-application-slices";
import { loadCreditBatchRollups } from "./credit-batch-accounting";
import { getCertifiedLineage, assertCanMutateCertifiedLineage } from "./certification-lineage-guards";
import { inDeliveryCreditBatchLineage } from "./credit-batch-lineage-filter";
import { biocharTransportEvidenceDocumentCount } from "./transport-evidence-projections";
import { getChainOfCustodyData } from "./chain-of-custody";

const url = process.env.PROVENANCE_DB_TEST_URL;
const ctx: OrgContext = { organizationId: "provenance-org", userId: "provenance-user", orgRole: "owner", isPlatformAdmin: false };
const other: OrgContext = { ...ctx, organizationId: "other-org" };
const ids = Object.fromEntries(["formulation", "facility", "A", "B", "C", "runA", "runB", "delivery", "order", "app", "batchA", "batchB", "removal", "bin"].map(key => [key, randomUUID()]));
const org = { organizationId: ctx.organizationId };
let client: Client;
let executor: typeof db;
let tx: DbTransaction;

// No persistent DDL and no migrations: shadow just the tables exercised here.
const tables: PgTable[] = [schema.applications, schema.applicationOutputAllocations, schema.biocharProducts,
  schema.deliveries, schema.orders, schema.outputStockAllocations, schema.outputStockRunAllocations,
  schema.productionRuns, schema.creditBatchApplications, schema.creditBatchProductionRuns, schema.creditBatches,
  schema.facilities, schema.feedstockTypes, schema.formulations, schema.reactors, schema.storageLocations,
  schema.productionRunFeedstocks, schema.feedstocks, schema.feedstockDeliveries, schema.suppliers,
  schema.samples, schema.certifierRemovals, schema.certificationSubmissions, schema.documents];
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

describe.skipIf(!url)("saved provenance PostgreSQL consumer queries", () => {
  beforeEach(async () => {
    if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("Local PostgreSQL URL required");
    client = new Client({ connectionString: url });
    await client.connect();
    await client.query("begin");
    for (const table of tables) {
      const config = getTableConfig(table);
      const columns = config.columns.map(column => `${quote(column.name)} ${column.columnType === "PgEnumColumn" ? "text" : column.getSQLType()}${column.name === "id" ? " default gen_random_uuid()" : ""}`);
      await client.query(`create temporary table ${quote(config.name)} (${columns.join(", ")}) on commit drop`);
    }
    await client.query("create unique index on credit_batch_applications (credit_batch_id, application_id)");
    executor = drizzle(client, { schema }) as unknown as typeof db;
    tx = executor as unknown as DbTransaction;
    vi.spyOn(db, "transaction").mockImplementation(async callback => callback(tx));
    vi.spyOn(db, "select").mockImplementation(executor.select.bind(executor));
    await executor.insert(schema.facilities).values({ ...org, id: ids.facility, code: "F", name: "Fixture" });
    await executor.insert(schema.storageLocations).values({ ...org, id: ids.bin, facilityId: ids.facility, code: "BIN", name: "Fixture bin", type: "product_bin" });
    await executor.insert(schema.productionRuns).values(["A", "B"].map(label => ({ ...org, id: ids[`run${label}`], facilityId: ids.facility, code: `R${label}`, reactorId: randomUUID(), status: "complete" as const, biocharDryMassKg: 1000 })));
    await executor.insert(schema.formulations).values({ ...org, id: ids.formulation, code: "FORM", name: "Fixture pure", biocharRatio: 1 });
    await executor.insert(schema.biocharProducts).values(["A", "B", "C"].map(label => ({ ...org, id: ids[label], facilityId: ids.facility, code: label, formulationId: ids.formulation, placedAt: "2026-01-01", productionDate: new Date("2026-01-01"), massKg: 2500 })));
    await executor.execute(sql`insert into orders (organization_id, id, facility_id, formulation_id, code, order_date, quantity_kg) values (${ctx.organizationId}, ${ids.order}, ${ids.facility}, ${ids.formulation}, 'O', '2026-01-02', 2000)`);
    await executor.insert(schema.deliveries).values({ ...org, id: ids.delivery, facilityId: ids.facility, code: "D", orderId: ids.order, deliveryDate: new Date("2026-01-03"), status: "delivered", storageLocationId: ids.bin, deliveredWetMassKg: 2000, massDryKg: 1150 });
    // Original + reversal + replacement. The unrelated product C nets to zero.
    for (const [product, run, dry, wet] of [["A", "runA", 900, 1571.429], ["A", "runA", -900, -1571.429], ["A", "runA", 900, 1571.429], ["B", "runB", 250, 428.571], ["C", "runA", 10, 20], ["C", "runA", -10, -20]] as const) {
      const allocationId = randomUUID();
      await executor.insert(schema.outputStockAllocations).values({ ...org, id: allocationId, movementId: randomUUID(), sourceStorageLocationId: ids.bin, biocharProductId: ids[product], deliveryId: ids.delivery, dryMassKg: String(dry), wetMassKg: String(wet), basisSnapshot: {} });
      await executor.insert(schema.outputStockRunAllocations).values({ ...org, id: randomUUID(), allocationId, productionRunId: ids[run], dryMassKg: String(dry) });
    }
    await executor.insert(schema.creditBatches).values(["A", "B"].map(label => ({ ...org, id: ids[`batch${label}`], facilityId: ids.facility, code: `CB${label}`, feedstockTypeId: randomUUID(), productionProcessId: randomUUID(), startDate: "2026-01-01", endDate: "2026-01-02" })));
    await executor.insert(schema.creditBatchProductionRuns).values(["A", "B"].map(label => ({ ...org, id: randomUUID(), creditBatchId: ids[`batch${label}`], productionRunId: ids[`run${label}`] })));
    const [app] = await executor.insert(schema.applications).values({ ...org, id: ids.app, code: "AP", deliveryId: ids.delivery, applicationDate: new Date("2026-01-04"), biocharAppliedTons: 1, biocharAppliedDryTons: 0.575, fieldSizeHa: 1, evidenceMethod: "location" }).returning();
    await saveApplicationOutputAllocations(ctx, tx, app);
    await reconcileUnassignedCreditBatchApplicationSlices(ctx, tx, { applicationIds: [ids.app] });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (client) { await client.query("rollback"); await client.end(); }
  });

  it("nets reversals before wet/run joins, ignores unused C and fails closed across orgs", async () => {
    const shares = await getDeliveryAllocationProvenance(ctx, [ids.delivery], executor);
    expect(shares.map(s => [s.biocharProductId, s.dryMassKg]).sort()).toEqual([[ids.A, 900], [ids.B, 250]].sort());
    expect(shares.reduce((sum, s) => sum + s.wetMassKg, 0)).toBe(2000);
    await expect(getDeliveryAllocationProvenance(other, [ids.delivery], executor)).rejects.toThrow(/organization/i);
    await executor.delete(schema.outputStockRunAllocations).where(eq(schema.outputStockRunAllocations.productionRunId, ids.runB));
    await expect(getDeliveryAllocationProvenance(ctx, [ids.delivery], executor)).rejects.toThrow("balance");
  });

  it("finds both batch slices and filters, and keeps a captured A slice when reconciling B alone", async () => {
    const rollups = await loadCreditBatchRollups(ctx, [ids.batchA, ids.batchB]);
    expect(rollups[ids.batchA].lineageFacts.applications[0].biocharAppliedDryTons).toBe(0.45);
    expect(rollups[ids.batchB].lineageFacts.applications[0].biocharAppliedDryTons).toBe(0.125);
    for (const batchId of [ids.batchA, ids.batchB]) {
      const filtered = await executor.select({ id: schema.deliveries.id }).from(schema.deliveries).where(and(eq(schema.deliveries.organizationId, ctx.organizationId), inDeliveryCreditBatchLineage(ctx, batchId, schema.deliveries.id)));
      expect(filtered.map(row => row.id)).toEqual([ids.delivery]);
    }
    await executor.update(schema.creditBatchApplications).set({ removalId: ids.removal }).where(eq(schema.creditBatchApplications.creditBatchId, ids.batchA));
    const before = await executor.select().from(schema.creditBatchApplications).where(eq(schema.creditBatchApplications.creditBatchId, ids.batchA));
    await reconcileUnassignedCreditBatchApplicationSlices(ctx, tx, { creditBatchIds: [ids.batchB] });
    expect(await executor.select().from(schema.creditBatchApplications).where(eq(schema.creditBatchApplications.creditBatchId, ids.batchA))).toEqual(before);
    const chain = await getChainOfCustodyData(ctx, ids.app);
    expect(chain.products?.map(p => p.product.id).sort()).toEqual([ids.A, ids.B].sort());
    expect(chain.sources?.reduce((n, s) => n + (s.allocatedDryMassKg ?? 0), 0)).toBe(575);
  });

  it("removes stale unowned slices when product B loses its last batch membership", async () => {
    await executor.delete(schema.creditBatchProductionRuns).where(eq(schema.creditBatchProductionRuns.productionRunId, ids.runB));
    await reconcileUnassignedCreditBatchApplicationSlices(ctx, tx, { biocharProductIds: [ids.B] });
    const slices = await executor.select().from(schema.creditBatchApplications);
    expect(slices.map(slice => slice.creditBatchId)).toEqual([ids.batchA]);
    expect(slices[0].allocatedDryMassKg).toBe(450);
  });

  it("retains A and B when they share a source run and credit batch", async () => {
    await executor.update(schema.applicationOutputAllocations).set({ productionRunId: ids.runA }).where(eq(schema.applicationOutputAllocations.biocharProductId, ids.B));
    await reconcileUnassignedCreditBatchApplicationSlices(ctx, tx, { applicationIds: [ids.app] });
    const facts = (await loadCreditBatchRollups(ctx, [ids.batchA]))[ids.batchA].lineageFacts;
    expect(facts.applications).toHaveLength(2);
    expect(facts.applications.reduce((n, a) => n + (a.biocharAppliedDryTons ?? 0), 0)).toBe(0.575);
    expect(new Set(facts.applications.map(a => a.biocharProduct.id))).toEqual(new Set([ids.A, ids.B]));
  });

  it("resolves a B-only captured lineage through truck, product, application and source without locking unused C", async () => {
    await executor.insert(schema.certifierRemovals).values({ ...org, id: ids.removal, facilityId: ids.facility });
    await executor.update(schema.creditBatchApplications).set({ removalId: ids.removal }).where(eq(schema.creditBatchApplications.creditBatchId, ids.batchB));
    for (const [entityType, entityId] of [["delivery", ids.delivery], ["application", ids.app], ["biocharProduct", ids.B], ["productionRun", ids.runB]] as const) {
      expect(await getCertifiedLineage(ctx, tx, { entityType, entityId })).toHaveLength(1);
    }
    await executor.insert(schema.certificationSubmissions).values({ ...org, id: randomUUID(), provider: "isometric", localEntityType: "removal", localEntityId: ids.removal, submissionType: "removal", status: "submitted" });
    await expect(assertCanMutateCertifiedLineage(ctx, tx, { entityType: "delivery", entityId: ids.delivery }, "update")).rejects.toThrow();
    await expect(assertCanMutateCertifiedLineage(ctx, tx, { entityType: "biocharProduct", entityId: ids.B }, "update")).rejects.toThrow();
    await expect(assertCanMutateCertifiedLineage(ctx, tx, { entityType: "biocharProduct", entityId: ids.C }, "update")).resolves.toBeUndefined();
    await expect(assertCanMutateCertifiedLineage(ctx, tx, { entityType: "delivery", entityId: ids.delivery }, "create", "application")).resolves.toBeUndefined();
    const [app] = await executor.select().from(schema.applications).where(eq(schema.applications.id, ids.app));
    await expect(saveApplicationOutputAllocations(ctx, tx, app)).rejects.toThrow("Removal");
    expect(await getCertifiedLineage(ctx, tx, { entityType: "biocharProduct", entityId: ids.C })).toHaveLength(0);
    expect(await getCertifiedLineage(other, tx, { entityType: "delivery", entityId: ids.delivery })).toHaveLength(0);
  });

  it("persists repeated partial applications and closes every saved source gram", async () => {
    for (const [wet, dry] of [[0.333333, 0.191667], [0.333333, 0.191667], [0.333334, 0.191666]]) {
      const [app] = await executor.insert(schema.applications).values({ ...org, id: randomUUID(), code: "PARTIAL", deliveryId: ids.delivery, applicationDate: new Date("2026-01-04"), biocharAppliedTons: wet, biocharAppliedDryTons: dry }).returning();
      await saveApplicationOutputAllocations(ctx, tx, app);
      await reconcileUnassignedCreditBatchApplicationSlices(ctx, tx, { applicationIds: [app.id] });
    }
    const shares = await executor.select().from(schema.applicationOutputAllocations);
    for (const [product, dry, wet] of [[ids.A, 900000, 1571429], [ids.B, 250000, 428571]] as const) {
      const rows = shares.filter(row => row.biocharProductId === product);
      expect(rows.reduce((n, row) => n + Math.round(Number(row.dryMassKg) * 1000), 0)).toBe(dry);
      expect(rows.reduce((n, row) => n + Math.round(Number(row.wetMassKg) * 1000), 0)).toBe(wet);
    }
  });

  it("evaluates transport evidence for both products without reversal-row duplication", async () => {
    for (const productId of [ids.A, ids.B]) {
      const query = () => executor.select({ count: biocharTransportEvidenceDocumentCount(ctx, schema.biocharProducts.id) }).from(schema.biocharProducts).where(eq(schema.biocharProducts.id, productId));
      expect(Number((await query())[0].count)).toBe(0);
    }
    await executor.execute(sql`insert into documents (id, organization_id, entity_type, entity_id, document_type, upload_status) values (${randomUUID()}, ${ctx.organizationId}, 'delivery', ${ids.delivery}, 'weighbridge_ticket', 'uploaded')`);
    const counts = await executor.select({ id: schema.biocharProducts.id, count: biocharTransportEvidenceDocumentCount(ctx, schema.biocharProducts.id) }).from(schema.biocharProducts).where(eq(schema.biocharProducts.organizationId, ctx.organizationId));
    expect(counts.filter(r => r.id !== ids.C).map(r => Number(r.count))).toEqual([1, 1]);
    expect(Number(counts.find(r => r.id === ids.C)?.count)).toBe(0);
  });
});
