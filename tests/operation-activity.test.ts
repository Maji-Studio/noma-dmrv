import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { activityEvents, apiAuditEvents, facilities, samples } from "@/db/schema";
import { uploadFactsFor } from "@/data-access/document-writes";
import { requestDocumentUploadApp, confirmDocumentUploadApp, deleteDocumentApp, setDocumentVisibilityApp } from "@/lib/operations/documents";
import * as activityWriter from "@/data-access/activity-events";
import { deleteSampleFn } from "@/fn/samples";
import { createOrderFn } from "@/fn/orders";
import { POST as MCP } from "@/app/api/mcp/route";
import { recordLabSample } from "@/lib/operations/lab-samples";
import { recordDeliveryForUi } from "@/lib/operations/deliveries";
import { recordOutputStockMovement } from "@/lib/operations/output-stock";
import { recordOrder } from "@/lib/operations/orders";
import { makeBiocharProduct } from "@/lib/operations/biochar-products";
import { logFeedstockDelivery } from "@/lib/operations/feedstocks";
import { runOperation, runOperationInProcess } from "@/lib/operations/runner";
import { createOrderSchema } from "@/schemas/orders";
import { createApiOrderWriteFixture, orderRows, orderRecords, orderAudits, postOrder, type ApiOrderWriteFixture } from "./helpers/api-order-write-fixture";
import { removeApiOrderReadFixture } from "./helpers/api-order-read-fixture";
import { orderInput } from "./helpers/order-operation-fixture";
import { createApiProductFixture, type ApiProductFixture } from "./helpers/api-biochar-product-fixture";
import { pureProductBody, postMovementRest } from "./helpers/api-biochar-write-fixture";
import { cleanupOutputStockFixture } from "./helpers/output-stock-cleanup";
import { createIntakeFixture, removeIntakeFixture, type IntakeFixture } from "./helpers/operation-fixture";
import { createApiDeliveryWriteFixture, deliveryInput, removeApiDeliveryWriteFixture, type ApiDeliveryWriteFixture } from "./helpers/api-delivery-write-fixture";
import { TEST_SITE_POSITION } from "./helpers/test-org";
import { createLabSampleFixture, cleanupLabSampleFixture, type LabSampleFixture } from "./helpers/lab-sample-fixture";
import { createApiLabFixture, type ApiLabFixture } from "./helpers/api-lab-sample-fixture";
import { deleteLabSample as deleteLabSampleRest, readRestLabSample } from "./helpers/api-lab-sample-write-fixture";
import { deleteOutputFacilityFixtures } from "./helpers/output-contract-fixtures";
import { rpc, rpcBody } from "./helpers/mcp";

const auth = vi.hoisted(() => ({ requireOrgContext: vi.fn() }));
vi.mock("@/lib/auth/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/server")>(), requireOrgContext: auth.requireOrgContext,
}));

const TIMEOUT_MS = 60_000;
const activity = (organizationId: string) => db.select().from(activityEvents)
  .where(eq(activityEvents.organizationId, organizationId)).orderBy(activityEvents.sequence);

describe("runner activity across transports", { timeout: TIMEOUT_MS }, () => {
  let f: ApiOrderWriteFixture | undefined;
  beforeEach(async () => { f = await createApiOrderWriteFixture(); });
  afterEach(async () => {
    vi.restoreAllMocks();
    auth.requireOrgContext.mockReset();
    if (f) await removeApiOrderReadFixture(f);
    f = undefined;
  });

  it("records equivalent events for the same order via Server Action, REST and MCP", async () => {
    const fixture = f!;
    const input = { ...orderInput(fixture), packaging: "bagged" };
    auth.requireOrgContext.mockResolvedValue(fixture.ctx);
    const ui = await createOrderFn(createOrderSchema.parse(input));
    expect(ui.success).toBe(true);
    if (!ui.success) throw new Error("Order action failed");
    const rest = await postOrder(fixture, input);
    expect(rest.status).toBe(201);
    const restRow = (await rest.json()).data;
    const mcpResponse = await MCP(rpc(fixture.writeOnlyKey, "tools/call", {
      name: "record_order", arguments: { ...input, requestKey: randomUUID() },
    }));
    expect(mcpResponse.status).toBe(200);
    const mcp = (await rpcBody(mcpResponse)).result;
    expect(mcp.isError).toBeUndefined();

    const events = await activity(fixture.ctx.organizationId);
    expect(events).toHaveLength(3);
    expect(events.map(event => event.entityId)).toEqual([ui.data.id, restRow.id, mcp.structuredContent.data.id]);
    expect(events.map(event => event.source)).toEqual(["form", "rest", "mcp"]);
    const comparable = events.map(({ action, entityType, changedFields, facilityId, actorUserId, productionRunId, creditBatchId }) =>
      ({ action, entityType, changedFields, facilityId, actorUserId, productionRunId, creditBatchId }));
    expect(comparable[1]).toEqual(comparable[0]);
    expect(comparable[2]).toEqual(comparable[0]);
    expect(comparable[0]).toMatchObject({ action: "created", entityType: "order", facilityId: fixture.facility.id, actorUserId: fixture.ctx.userId });
    expect(events[0]).toMatchObject({ credentialId: null, requestId: null });
    for (const event of events.slice(1)) {
      const audit = (await orderAudits(fixture)).find(row => row.requestId === event.requestId);
      expect(audit).toBeDefined();
      expect(event.credentialId).toBe(audit!.credentialId);
    }
    expect(JSON.stringify(events, (_key, value) => typeof value === "bigint" ? value.toString() : value))
      .not.toContain(input.packaging);
    expect(await orderAudits(fixture)).toHaveLength(2);
  });

  it("writes nothing on a REST replay or dry run", async () => {
    const fixture = f!;
    const input = orderInput(fixture);
    const key = randomUUID();
    expect((await postOrder(fixture, input, key)).status).toBe(201);
    const first = await activity(fixture.ctx.organizationId);
    expect(first).toHaveLength(1);
    const replay = await postOrder(fixture, input, key);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect((await postOrder(fixture, input, randomUUID(), "?dryRun=true")).status).toBe(200);
    expect(await activity(fixture.ctx.organizationId)).toEqual(first);
    expect(await orderRows(fixture)).toHaveLength(1);
    expect(await orderRecords(fixture)).toHaveLength(1);
    expect(await orderAudits(fixture)).toHaveLength(1);
  });

  it("rolls back an inserted activity, the business write and the idempotency claim together", async () => {
    const fixture = f!;
    const write = activityWriter.recordActivity;
    const failure = new Error("Injected failure after activity insert");
    vi.spyOn(activityWriter, "recordActivity").mockImplementationOnce(async (ctx, tx, event) => {
      await write(ctx, tx, event);
      expect(await tx.select().from(activityEvents).where(and(
        eq(activityEvents.organizationId, ctx.organizationId), eq(activityEvents.entityId, event.entityId),
      ))).toHaveLength(1);
      throw failure;
    });
    await expect(runOperation(recordOrder, fixture.ctx, orderInput(fixture), {
      audit: { transport: "rest", credentialId: "activity-test", requestId: randomUUID() },
      idempotency: { credentialId: "activity-test", key: randomUUID() },
    })).rejects.toBe(failure);
    expect(await activity(fixture.ctx.organizationId)).toEqual([]);
    expect(await orderRows(fixture)).toEqual([]);
    expect(await orderRecords(fixture)).toEqual([]);
    expect(await orderAudits(fixture)).toEqual([]);
  });
});

describe("product resubmission activity", { timeout: TIMEOUT_MS }, () => {
  let f: ApiProductFixture | undefined;
  beforeEach(async () => { f = await createApiProductFixture(); });
  afterEach(async () => {
    if (f) await cleanupOutputStockFixture(db, f.ctx.organizationId);
    f = undefined;
  });

  it.each([false, true])("records no activity or API audit when re-returning a product (facility-local: %s)", async (local) => {
    const fixture = f!;
    const input = pureProductBody(fixture, {
      idempotencyKey: randomUUID(), ...(local ? { placedAt: { date: "2026-09-12", time: "12:00" } } : {}),
    });
    const first = await runOperationInProcess(makeBiocharProduct, fixture.ctx, input);
    const events = await activity(fixture.ctx.organizationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ entityType: "biochar_product", entityId: first.product.id, productionRunId: fixture.r1 });
    const repeated = await runOperation(makeBiocharProduct, fixture.ctx, input, {
      audit: { transport: "rest", credentialId: "activity-test", requestId: randomUUID() },
    });
    expect(repeated.data.product.id).toBe(first.product.id);
    expect(repeated).not.toHaveProperty("effect");
    expect(await activity(fixture.ctx.organizationId)).toEqual(events);
    expect(await db.select().from(apiAuditEvents).where(eq(apiAuditEvents.organizationId, fixture.ctx.organizationId))).toEqual([]);
  });

  it("records exactly one event when resubmitting a stock movement's form key", async () => {
    const fixture = f!;
    const input = {
      storageLocationId: fixture.source.id, kind: "loss", occurredAt: "2026-09-12T11:00:00Z",
      wetMassKg: 10, moisturePercent: 10, reason: "Spilled", idempotencyKey: randomUUID(),
    };
    const first = await runOperationInProcess(recordOutputStockMovement, fixture.ctx, input);
    const repeated = await runOperationInProcess(recordOutputStockMovement, fixture.ctx, input);
    expect(repeated.movementId).toBe(first.movementId);
    const events = await activity(fixture.ctx.organizationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ entityType: "bin_movement", entityId: first.movementId, facilityId: fixture.facility.id });
  });

  it("keeps stock movement links identical through UI and REST", async () => {
    const fixture = f!;
    const { storageLocationId, ...body } = {
      storageLocationId: fixture.source.id, kind: "loss", occurredAt: "2026-09-12T11:00:00Z",
      wetMassKg: 10, moisturePercent: 10, reason: "Spilled",
    };
    const ui = await runOperationInProcess(recordOutputStockMovement, fixture.ctx, { storageLocationId, ...body });
    const rest = await postMovementRest(fixture, storageLocationId, body);
    expect(rest.status).toBe(201);
    const restRow = (await rest.json()).data;
    const events = await activity(fixture.ctx.organizationId);
    expect(events.map(event => event.entityId)).toEqual([ui.movementId, restRow.id]);
    expect(events.map(event => event.source)).toEqual(["form", "rest"]);
    const links = events.map(({ facilityId, productionRunId, creditBatchId }) => ({ facilityId, productionRunId, creditBatchId }));
    expect(links[1]).toEqual(links[0]);
    expect(links[0]).toEqual({ facilityId: fixture.facility.id, productionRunId: fixture.r1, creditBatchId: null });
    expect(ui).not.toHaveProperty("facilityId");
    expect(ui).not.toHaveProperty("replayed");
  });

  it("cleans only activity linked to the selected facility in a shared organization", async () => {
    const fixture = f!;
    const organizationId = fixture.ctx.organizationId;
    const [other] = await db.insert(facilities).values({ ...TEST_SITE_POSITION, organizationId, code: `E2E-OTHER-${fixture.tag}`, name: "Other fixture", timezone: "UTC" }).returning();
    await db.transaction(async tx => {
      for (const facilityId of [fixture.facility.id, other.id, null]) {
        await activityWriter.recordActivity(fixture.ctx, tx, {
          action: "created", entityType: "order", entityId: randomUUID(), source: "form", facilityId,
        });
      }
    });
    await deleteOutputFacilityFixtures(db, eq(facilities.id, other.id));
    const events = await activity(organizationId);
    expect(events).toHaveLength(2);
    expect(events.map(event => event.facilityId)).toEqual([fixture.facility.id, null]);
  });
});

describe("split intake activity", () => {
  let f: IntakeFixture | undefined;
  afterEach(async () => { if (f) await removeIntakeFixture(f); f = undefined; });

  it("records one event per returned allocation ID", async () => {
    f = await createIntakeFixture("activity");
    // Two allocations can receive into the same bin; each creates its own intake record.
    const wetMassKg = 100;
    const input = { ...f.input(wetMassKg * 2), allocations: [
      { storageLocationId: f.binId, allocatedWetMassKg: wetMassKg },
      { storageLocationId: f.binId, allocatedWetMassKg: wetMassKg },
    ] };
    const result = await runOperationInProcess(logFeedstockDelivery, f.ctx, input);
    // Derived transport legs record their own system events (#1041).
    const events = (await activity(f.ctx.organizationId)).filter(event => event.entityType === "feedstock");
    expect(events.map(event => event.entityId).sort()).toEqual(result.feedstocks.map(row => row.id).sort());
    expect(events).toHaveLength(2);
    expect(events.every(event => event.facilityId === f!.facilityId && event.source === "form")).toBe(true);
  });
});


describe("delivery resubmission activity", { timeout: TIMEOUT_MS }, () => {
  let f: ApiDeliveryWriteFixture | undefined;
  beforeEach(async () => { f = await createApiDeliveryWriteFixture(); });
  afterEach(async () => { if (f) await removeApiDeliveryWriteFixture(f); f = undefined; });

  it("records exactly one event when resubmitting a delivery's form key", async () => {
    const fixture = f!;
    const input = deliveryInput(fixture, { idempotencyKey: randomUUID() });
    const first = await runOperationInProcess(recordDeliveryForUi, fixture.ctx, input);
    const repeated = await runOperationInProcess(recordDeliveryForUi, fixture.ctx, input);
    expect(repeated.delivery.id).toBe(first.delivery.id);
    const events = await activity(fixture.ctx.organizationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ entityType: "delivery", entityId: first.delivery.id, facilityId: fixture.facility.id });
  });
});

describe("lab sample deletion activity", { timeout: TIMEOUT_MS }, () => {
  let f: ApiLabFixture | undefined;
  afterEach(async () => {
    auth.requireOrgContext.mockReset();
    if (f) {
      await db.delete(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId));
      await cleanupLabSampleFixture(f);
    }
    f = undefined;
  });

  it("keeps batch, run and facility links identical through UI and REST deletes", async () => {
    f = await createApiLabFixture({ withSecondBatch: false });
    const { sample } = await runOperationInProcess(recordLabSample, f.ctx, {
      creditBatchId: f.batchA.id, samplingTime: "2026-09-14T12:00:00Z",
      totalCarbonPercent: 80, organicCarbonPercent: 75,
    });
    await db.update(samples).set({ productionRunId: f.batchA.runId }).where(and(
      eq(samples.organizationId, f.ctx.organizationId), eq(samples.id, sample.id),
    ));
    const { sample: restSample } = await runOperationInProcess(recordLabSample, f.ctx, {
      creditBatchId: f.batchA.id, samplingTime: "2026-09-14T12:00:00Z",
      totalCarbonPercent: 80, organicCarbonPercent: 75,
    });
    await db.update(samples).set({ productionRunId: f.batchA.runId }).where(and(
      eq(samples.organizationId, f.ctx.organizationId), eq(samples.id, restSample.id),
    ));
    const { etag } = await readRestLabSample(f, restSample.id);
    auth.requireOrgContext.mockResolvedValue(f.ctx);
    const result = await deleteSampleFn({ sampleId: sample.id, expectedVersion: sample.version });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Sample deletion failed");
    expect(result.data).toBeUndefined();
    expect((await deleteLabSampleRest(f, restSample.id, etag)).status).toBe(204);
    const events = (await activity(f.ctx.organizationId)).filter(event => event.action === "deleted");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      action: "deleted", entityType: "lab_sample", entityId: sample.id, source: "form",
      creditBatchId: f.batchA.id, facilityId: f.facility.id, productionRunId: f.batchA.runId,
    });
    expect(events[1]).toMatchObject({ entityId: restSample.id, source: "rest" });
    const links = events.map(({ facilityId, productionRunId, creditBatchId }) => ({ facilityId, productionRunId, creditBatchId }));
    expect(links[1]).toEqual(links[0]);
  });
});

describe("UI document activity", { timeout: TIMEOUT_MS }, () => {
  let f: LabSampleFixture | undefined;
  afterEach(async () => {
    if (f) await cleanupLabSampleFixture(f);
    f = undefined;
  });

  it.each(["production_run", "credit_batch"] as const)("records request, confirmation, visibility and deletion with %s owner links", async (entityType) => {
    f = await createLabSampleFixture({ withSecondBatch: false });
    const entityId = entityType === "production_run" ? f.batchA.runId : f.batchA.id;
    const declaration = {
      entityType, entityId, documentType: "pdf", fileName: "private-evidence.pdf", contentType: "application/pdf",
      sizeBytes: 8, sha256: "a".repeat(64), storageProvider: "local-fs", storageBucket: "local-fs",
    };
    const document = await runOperationInProcess(requestDocumentUploadApp, f.ctx, declaration);
    const facts = { ...uploadFactsFor(document), finalKey: `org/${f.ctx.organizationId}/evidence/${document.id}`,
      inspectedSha256: declaration.sha256, inspectedSizeBytes: declaration.sizeBytes, inspectedContentType: declaration.contentType };
    const confirmed = await runOperationInProcess(confirmDocumentUploadApp, f.ctx, facts);
    expect(confirmed).toMatchObject({ kind: "uploaded", transitioned: true });
    if (confirmed.kind !== "uploaded") throw new Error("Document confirmation failed");
    const repeated = await runOperationInProcess(confirmDocumentUploadApp, f.ctx, facts);
    expect(repeated).toMatchObject({ kind: "uploaded", transitioned: false });
    const visible = await runOperationInProcess(setDocumentVisibilityApp, f.ctx, {
      documentId: document.id, expectedVersion: confirmed.document.version, visibility: "public",
    });
    await runOperationInProcess(deleteDocumentApp, f.ctx, { documentId: document.id, expectedVersion: visible.version });
    const events = await activity(f.ctx.organizationId);
    expect(events).toHaveLength(4);
    expect(events.map(event => event.action)).toEqual(["created", "updated", "updated", "deleted"]);
    for (const event of events) expect(event).toMatchObject({
      entityType: "document", entityId: document.id, source: "form",
      productionRunId: entityType === "production_run" ? entityId : null,
      creditBatchId: entityType === "credit_batch" ? entityId : null,
    });
    expect(events[1].changedFields).toEqual(["uploadStatus", "version"]);
    expect(events[2].changedFields).toEqual(["visibility"]);
    expect(events[3].changedFields).toEqual([]);
    const serialized = JSON.stringify(events, (_key, value) => typeof value === "bigint" ? value.toString() : value);
    for (const value of [declaration.fileName, declaration.sha256, declaration.contentType, facts.finalKey]) expect(serialized).not.toContain(value);
  });
});
