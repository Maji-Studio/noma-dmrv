import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiAuditEvents, apiIdempotencyRecords, binMovements, deliveries, drivers, orders, vehicles } from "@/db/schema";
import { getOutputBinAllLayersDryKg } from "@/data-access/output-stock";
import { recordDelivery, recordDeliveryForUi, updateDeliveryOperation } from "@/lib/operations/deliveries";
import { GENERATED_MOVEMENT_KEY_PREFIX } from "@/lib/operations/output-stock";
import { runOperation, runOperationInProcess } from "@/lib/operations/runner";
import { runWithStockBasisPreview } from "@/lib/operations/stock-basis-preview";
import { createDeliveryFixture } from "./helpers/delivery-create-fixture";
import { cleanupOutputStockFixture } from "./helpers/output-stock-cleanup";
import { certifyOutputLineage, cleanupCertifiedOutputLineage } from "./helpers/certified-output-lineage";
import { DomainError } from "@/lib/domain-errors";
import { actionFailureResponse } from "@/lib/api/problem";

vi.hoisted(() => { process.env.DB_POOL_MAX = "1"; });
const SUITE_TIMEOUT_MS = 60_000;
const PREVIEW_DEADLINE_MS = 10_000;
const NO_SELF_WAIT_MS = 5_000;
const FIRST_VERSION = 2;
const WET_KG = 40;
const MOISTURE_PERCENT = 20;
const SOLIDS_KG = 32;
const DRY_BIOCHAR_KG = 28.8;
type Fixture = Awaited<ReturnType<typeof createDeliveryFixture>>;
const fixtures: Fixture[] = [];
async function fixture() { const f = await createDeliveryFixture(); fixtures.push(f); return f; }
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    const scoped = f.ctx.organizationId;
    await db.delete(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, scoped));
    await db.delete(apiAuditEvents).where(eq(apiAuditEvents.organizationId, scoped));
    await db.update(deliveries).set({ driverId: null, vehicleId: null }).where(eq(deliveries.organizationId, scoped));
    await db.delete(drivers).where(eq(drivers.organizationId, scoped));
    await db.delete(vehicles).where(eq(vehicles.organizationId, scoped));
    await cleanupCertifiedOutputLineage(scoped);
    await cleanupOutputStockFixture(db, scoped);
  }
});
function input(f: Fixture, changes: Record<string, unknown> = {}) {
  const facts: Partial<typeof f.input> = { ...f.input }; delete facts.idempotencyKey;
  return { ...facts, deliveredWetMassKg: WET_KG, ...changes };
}
const rows = (f: Fixture) => db.select().from(deliveries).where(eq(deliveries.organizationId, f.ctx.organizationId));
const movements = (f: Fixture) => db.select().from(binMovements).where(and(eq(binMovements.organizationId, f.ctx.organizationId), eq(binMovements.outputKind, "delivery")));
const stock = (f: Fixture) => getOutputBinAllLayersDryKg(f.ctx, f.bin.id, db);
const keyed = (f: Fixture) => ({ idempotency: { credentialId: `delivery-${f.tag}`, key: randomUUID() },
  audit: { credentialId: `delivery-${f.tag}`, requestId: randomUUID(), transport: "rest" as const } });
const record = (f: Fixture, changes: Record<string, unknown> = {}) => runOperation(recordDelivery, f.ctx, input(f, changes));

// Each runner uses the same one-connection pool as fixtures, catching escaped global reads.
describe("delivery record on the runner with one connection", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("posts a delivery with allocations and a JSON-safe result and effect", async () => {
    const f = await fixture();
    expect(db.$client.options.max).toBe(1);
    const started = Date.now();
    const result = await record(f);
    expect(Date.now() - started).toBeLessThan(NO_SELF_WAIT_MS);
    expect(result.data.delivery).toMatchObject({ version: FIRST_VERSION, deliveredWetMassKg: WET_KG,
      massDryKg: DRY_BIOCHAR_KG, moistureContentPercent: MOISTURE_PERCENT, deliveryDate: f.input.deliveredAt });
    expect(result.data.delivery.code).toMatch(/^DL-\d{2}-\d{3,}$/);
    expect(result.data.delivery).not.toHaveProperty("savedProducts");
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(result.data.allocations).toMatchObject([{ layerId: f.product.id, code: f.product.code,
      solidsKg: SOLIDS_KG, dryBiocharKg: DRY_BIOCHAR_KG, wetKg: WET_KG, moisturePercent: MOISTURE_PERCENT, policy: "pro_rata" }]);
    expect(result.effect).toEqual({ outcome: "created", entityType: "delivery", entityIds: [result.data.delivery.id],
      versionBefore: null, versionAfter: FIRST_VERSION, changedFields: ["deliveredAt", "deliveredWetMassKg", "moisturePercent", "orderId", "storageLocationId"] });
    const [movement] = await movements(f);
    expect(movement.idempotencyKey).toMatch(new RegExp(`^${GENERATED_MOVEMENT_KEY_PREFIX}`));
    expect(movement.basisFingerprint).toBe(result.data.basisFingerprint);
    expect((await db.select().from(orders).where(eq(orders.id, f.order.id)))[0].version).toBe(f.order.version);
  });

  it("retains native saved products, custom code and the stock key only for the in-process UI create", async () => {
    const f = await fixture();
    const facts = { ...input(f), code: "DL-UI", idempotencyKey: f.input.idempotencyKey };
    const created = await runOperationInProcess(recordDeliveryForUi, f.ctx, facts);
    expect(created.delivery).toMatchObject({ code: "DL-UI", deliveryDate: new Date(f.input.deliveredAt),
      savedProducts: [expect.objectContaining({ id: f.product.id, stockPostingSequence: expect.any(BigInt) })] });
    const replay = await runOperationInProcess(recordDeliveryForUi, f.ctx, facts);
    expect(replay.delivery.id).toBe(created.delivery.id);
    expect(replay.delivery.savedProducts).toEqual([]);
    expect((await movements(f)).map(row => row.idempotencyKey)).toEqual([f.input.idempotencyKey]);
  });

  it("also runs the registered create in process with native dates and its smaller output", async () => {
    const f = await fixture();
    const created = await runOperationInProcess(recordDelivery, f.ctx, input(f));
    expect(created.delivery.deliveryDate).toBeInstanceOf(Date);
    expect(created.delivery).not.toHaveProperty("savedProducts");
  });

  it("rolls back a dry run, returns stock effects and allocations, and never claims the runner key", async () => {
    const f = await fixture();
    const beforeMovements = await movements(f);
    const beforeStock = await stock(f);
    const options = keyed(f);
    const dry = await runOperation(recordDelivery, f.ctx, input(f), { ...options, dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.stockEffects).toMatchObject([{ storageLocationId: f.bin.id, delta: { dryKg: expect.closeTo(-DRY_BIOCHAR_KG) } }]);
    expect(await rows(f)).toEqual([]);
    expect(await movements(f)).toEqual(beforeMovements);
    expect(await stock(f)).toBe(beforeStock);
    expect(await db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, f.ctx.organizationId))).toEqual([]);
    expect(await db.select().from(apiAuditEvents).where(eq(apiAuditEvents.organizationId, f.ctx.organizationId))).toEqual([]);
    const committedInput = input(f, { basisFingerprint: dry.data.basisFingerprint });
    const written = await runOperation(recordDelivery, f.ctx, committedInput, options);
    expect(written.data.basisFingerprint).toBe(dry.data.basisFingerprint);
    expect(written.data.allocations).toEqual(dry.data.allocations);
    expect(await stock(f)).toBe(dry.stockEffects![0].after.dryKg);
    expect(written.effect?.changedFields).not.toContain("basisFingerprint");
    await expect(runOperation(recordDelivery, f.ctx, committedInput, { ...options, dryRun: true })).rejects.toMatchObject({ code: "key_already_used" });
  });

  it("replays reordered input after order archive and refuses changed payload under the same key", async () => {
    const f = await fixture();
    const options = keyed(f);
    const facts = input(f);
    const first = await runOperation(recordDelivery, f.ctx, facts, options);
    await db.update(orders).set({ archivedAt: new Date() }).where(eq(orders.id, f.order.id));
    const reordered = Object.fromEntries(Object.entries(facts).reverse());
    const replay = await runOperation(recordDelivery, f.ctx, reordered, options);
    expect(replay).toMatchObject({ replayed: true, data: first.data, effect: first.effect });
    expect(await rows(f)).toHaveLength(1);
    expect(await movements(f)).toHaveLength(1);
    expect(await db.select().from(apiAuditEvents).where(eq(apiAuditEvents.organizationId, f.ctx.organizationId))).toHaveLength(1);
    await expect(runOperation(recordDelivery, f.ctx, { ...facts, deliveredWetMassKg: WET_KG + 1 }, options))
      .rejects.toMatchObject({ code: "idempotency_key_reused" });
  });

  it("refuses a stale basis without saving and allows the adapter to attach a fresh preview", async () => {
    const f = await fixture();
    const dry = await runOperation(recordDelivery, f.ctx, input(f), { dryRun: true });
    await record(f);
    const options = keyed(f);
    const stale = input(f, { basisFingerprint: dry.data.basisFingerprint });
    await expect(runOperation(recordDelivery, f.ctx, stale, options)).rejects.toMatchObject({ code: "stock_basis_changed" });
    await expect(runWithStockBasisPreview(recordDelivery, f.ctx, stale,
      { ...options, deadlineAt: Date.now() + PREVIEW_DEADLINE_MS }, data => data.basisFingerprint))
      .rejects.toMatchObject({ code: "stock_basis_changed", preview: { basisFingerprint: expect.any(String), stockEffects: expect.any(Array) } });
    expect(await rows(f)).toHaveLength(1);
    expect(await movements(f)).toHaveLength(1);
  });
});

describe("delivery metadata PATCH on the runner", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("changes metadata only, reports versions, and preserves omitted values and stock", async () => {
    const f = await fixture();
    const created = (await record(f)).data.delivery;
    const beforeMovements = await movements(f);
    const beforeStock = await stock(f);
    const saved = await runOperation(updateDeliveryOperation, f.ctx, { deliveryId: created.id, expectedVersion: created.version, code: "DL-PATCH", distanceNote: "Bill of lading" });
    expect(saved.data).toMatchObject({ code: "DL-PATCH", distanceNote: "Bill of lading", version: created.version + 1,
      deliveryDate: created.deliveryDate, orderId: created.orderId, storageLocationId: created.storageLocationId,
      deliveredWetMassKg: WET_KG, massDryKg: DRY_BIOCHAR_KG, moistureContentPercent: MOISTURE_PERCENT });
    expect(saved.effect).toEqual({ outcome: "updated", entityType: "delivery", entityIds: [created.id],
      versionBefore: created.version, versionAfter: created.version + 1, changedFields: ["code", "distanceNote"] });
    expect(saved.data).not.toHaveProperty("savedProducts");
    expect(await movements(f)).toEqual(beforeMovements);
    expect(await stock(f)).toBe(beforeStock);
    await expect(runOperation(updateDeliveryOperation, f.ctx, { deliveryId: created.id, expectedVersion: created.version, code: "DL-STALE" }))
      .rejects.toMatchObject({ code: "stale_version" });
  });

  it.each(["deliveredWetMassKg", "moisturePercent", "moistureContentPercent", "sources", "deliveredAt", "orderId", "storageLocationId", "idempotencyKey", "correctsMovementId"])("refuses unknown stock or frozen input %s before execution", async field => {
    const f = await fixture();
    const created = (await record(f)).data.delivery;
    await expect(runOperation(updateDeliveryOperation, f.ctx, { deliveryId: created.id, expectedVersion: created.version, [field]: null }))
      .rejects.toMatchObject({ code: "validation_failed" });
    expect(await rows(f)).toMatchObject([{ id: created.id, version: created.version }]);
  });

  it("refuses archived and foreign delivery targets with not_found", async () => {
    const f = await fixture();
    const foreign = await fixture();
    const created = (await record(f)).data.delivery;
    const foreignDelivery = (await record(foreign)).data.delivery;
    await db.update(deliveries).set({ archivedAt: new Date() }).where(eq(deliveries.id, created.id));
    for (const deliveryId of [created.id, foreignDelivery.id, randomUUID()]) {
      await expect(runOperation(updateDeliveryOperation, f.ctx, { deliveryId, expectedVersion: created.version, distanceNote: "Refused" }))
        .rejects.toMatchObject({ code: "not_found", issues: [expect.objectContaining({ path: ["deliveryId"] })] });
    }
  });

  it("refuses submitted delivery lineage at /deliveryId without changing rows or stock", async () => {
    const f = await fixture();
    await certifyOutputLineage(f, { runId: f.runs[0].id, productId: f.product.id, submitted: true });
    const beforeRows = await rows(f);
    const [delivery] = beforeRows;
    const beforeMovements = await movements(f);
    const beforeStock = await stock(f);
    try {
      await runOperation(updateDeliveryOperation, f.ctx, { deliveryId: delivery.id, expectedVersion: delivery.version, code: "DL-LOCKED-EDIT" }, keyed(f));
      expect.fail("Expected submitted lineage to refuse PATCH");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      if (!(error instanceof DomainError)) throw error;
      expect(error).toMatchObject({ code: "certification_locked", issues: [{ path: ["deliveryId"] }] });
      const response = actionFailureResponse({ success: false, error: error.message, code: error.code, issues: error.issues }, "/deliveries", randomUUID());
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "certification_locked", errors: [{ pointer: "/deliveryId", code: "certification_locked" }] });
    }
    expect(await rows(f)).toEqual(beforeRows);
    expect(await movements(f)).toEqual(beforeMovements);
    expect(await stock(f)).toBe(beforeStock);
    expect(await db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, f.ctx.organizationId))).toEqual([]);
    expect(await db.select().from(apiAuditEvents).where(eq(apiAuditEvents.organizationId, f.ctx.organizationId))).toEqual([]);
  });

  it("rolls back a metadata preview and replays a keyed PATCH after archive", async () => {
    const f = await fixture();
    const created = (await record(f)).data.delivery;
    const patch = { deliveryId: created.id, expectedVersion: created.version, code: "DL-PREVIEW" };
    const options = keyed(f);
    const dry = await runOperation(updateDeliveryOperation, f.ctx, patch, { ...options, dryRun: true });
    expect(dry.data.code).toBe("DL-PREVIEW");
    expect(dry.data).not.toHaveProperty("savedProducts");
    expect(await rows(f)).toMatchObject([{ id: created.id, code: created.code, version: created.version }]);
    const saved = await runOperation(updateDeliveryOperation, f.ctx, patch, options);
    expect(saved.data).not.toHaveProperty("savedProducts");
    const [outcome] = await db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, f.ctx.organizationId));
    expect(outcome.outcome).toMatchObject({ kind: "success", data: saved.data });
    expect(outcome.outcome).not.toHaveProperty("data.savedProducts");
    await db.update(deliveries).set({ archivedAt: new Date() }).where(eq(deliveries.id, created.id));
    const replay = await runOperation(updateDeliveryOperation, f.ctx, patch, options);
    expect(replay.data).toEqual(saved.data);
    expect(replay.data).not.toHaveProperty("savedProducts");
  });

  it("keeps, clears and sets one-way distance and supports source-only documentary provenance", async () => {
    const f = await fixture();
    let saved = (await record(f, { distanceKmOverride: 30, distanceSource: "manual", distanceNote: "Route evidence" })).data.delivery;
    const patch = async (changes: Record<string, unknown>) => {
      saved = (await runOperation(updateDeliveryOperation, f.ctx, { deliveryId: saved.id, expectedVersion: saved.version, ...changes })).data;
      return saved;
    };
    expect(await patch({})).toMatchObject({ distanceKmOverride: 30, distanceSource: "manual", distanceNote: "Route evidence" });
    expect(await patch({ distanceSource: "document" })).toMatchObject({ distanceKmOverride: 30, distanceSource: "document" });
    expect(await patch({ distanceKmOverride: null })).toMatchObject({ distanceKmOverride: null, distanceSource: null, distanceNote: "Route evidence" });
    expect(await patch({ distanceSource: "document" })).toMatchObject({ distanceKmOverride: null, distanceSource: "document" });
    expect(await patch({ distanceKmOverride: 40 })).toMatchObject({ distanceKmOverride: 40, distanceSource: "manual" });
    expect(await patch({ distanceSource: "map_estimate" })).toMatchObject({ distanceKmOverride: 40, distanceSource: "map_estimate" });
    expect(await patch({ distanceKmOverride: null, distanceSource: "document" })).toMatchObject({ distanceKmOverride: null, distanceSource: "document" });
    await expect(patch({ distanceKmOverride: 0 })).rejects.toMatchObject({ code: "validation_failed" });
  });

  it.each(["driverId", "vehicleId"] as const)("refuses foreign or unknown %s at its pointer and allows clearing an owned reference", async field => {
    const f = await fixture();
    const foreign = await fixture();
    const crew = async (target: Fixture) => field === "driverId"
      ? (await db.insert(drivers).values({ organizationId: target.ctx.organizationId, code: `E2E-D-${target.tag}`, name: "E2E Driver" }).returning())[0]
      : (await db.insert(vehicles).values({ organizationId: target.ctx.organizationId, code: `E2E-V-${target.tag}`, name: "E2E Vehicle", identifier: `E2E-${target.tag}`, vehicleType: "truck" }).returning())[0];
    const own = await crew(f);
    const other = await crew(foreign);
    const created = (await record(f, { [field]: own.id })).data.delivery;
    for (const referenceId of [other.id, randomUUID()]) {
      await expect(runOperation(updateDeliveryOperation, f.ctx, { deliveryId: created.id, expectedVersion: created.version, [field]: referenceId }))
        .rejects.toMatchObject({ code: "not_found", issues: [expect.objectContaining({ path: [field] })] });
    }
    const cleared = await runOperation(updateDeliveryOperation, f.ctx, { deliveryId: created.id, expectedVersion: created.version, [field]: null });
    expect(cleared.data[field]).toBeNull();
  });
});
