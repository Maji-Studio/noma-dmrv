/** Database coverage for transactional API write audit events. */
import { apiActivityWhere, stringifyWithBigint } from "./helpers/api-activity";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, apiIdempotencyRecords } from "@/db/schema";
import * as auditWriter from "@/data-access/activity-events";
import { logFeedstockDelivery, updateFeedstock, deleteFeedstock } from "@/lib/operations/feedstocks";
import { runOperation } from "@/lib/operations/runner";
import { createIntakeFixture, feedstockCount, removeIntakeFixture, type IntakeFixture } from "./helpers/operation-fixture";

let fixture: IntakeFixture;
beforeEach(async () => { fixture = await createIntakeFixture("audit"); });
afterEach(async () => { vi.restoreAllMocks(); await removeIntakeFixture(fixture); });
const MASS_INCREMENT_KG = 100;
const audit = () => ({ transport: "rest" as const, requestId: crypto.randomUUID(), credentialId: "audit-credential" });
const rows = () => db.select().from(activityEvents).where(apiActivityWhere(fixture.ctx.organizationId));
const records = () => db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, fixture.ctx.organizationId));

it("commits one audit and replays its effect without another event", async () => {
  const input = { ...fixture.input(), notes: "Private content must never appear in audit" };
  const options = { audit: audit(), idempotency: { credentialId: "audit-credential", key: crypto.randomUUID() } };
  const first = await runOperation(logFeedstockDelivery, fixture.ctx, input, options);
  expect(first.effect).toEqual({
    outcome: "created", entityType: "feedstock", entityIds: first.data.feedstocks.map((item) => item.id),
    versionBefore: null, versionAfter: 1,
    changedFields: ["code", "deliveryDate", "facilityId", "feedstockTypeId", "massDryKg", "massWetKg", "moistureContentPercent", "notes", "status", "storageLocationId", "supplierId", "transportDistanceKm", "transportDistanceSource"],
  });
  const events = await rows();
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    organizationId: fixture.ctx.organizationId, actorUserId: fixture.ctx.userId,
    credentialId: options.audit.credentialId, requestId: options.audit.requestId,
    operationId: logFeedstockDelivery.id, action: "created", entityId: first.data.feedstocks[0].id,
    changedFields: first.effect!.changedFields, versionBefore: null, versionAfter: 1,
  });
  expect(stringifyWithBigint(events)).not.toContain(input.notes);
  expect((await records())[0]).toMatchObject({ outcomeSchemaVersion: 2, outcome: { data: first.data, effect: first.effect } });
  const replay = await runOperation(logFeedstockDelivery, fixture.ctx, input, { ...options, audit: audit() });
  expect(replay).toEqual({ ...first, replayed: true });
  expect(await rows()).toEqual(events);
});

it("returns a dry-run effect without audit, business rows or idempotency claims", async () => {
  const result = await runOperation(logFeedstockDelivery, fixture.ctx, fixture.input(), {
    dryRun: true, audit: audit(), idempotency: { credentialId: "audit-credential", key: crypto.randomUUID() },
  });
  expect(result.effect).toMatchObject({ outcome: "created", versionAfter: 1, entityIds: [result.data.feedstocks[0].id] });
  expect(await rows()).toEqual([]);
  expect(await records()).toEqual([]);
  expect(await feedstockCount(fixture)).toBe(0);
});

it("rolls back audit, business rows and claim together after the audit insert", async () => {
  const write = auditWriter.recordActivity;
  const error = new Error("Injected failure after audit insert");
  vi.spyOn(auditWriter, "recordActivity").mockImplementation(async (ctx, tx, event) => {
    await write(ctx, tx, event);
    if (event.operationId !== logFeedstockDelivery.id) return;
    const inTransaction = await tx.select().from(activityEvents).where(apiActivityWhere(ctx.organizationId, eq(activityEvents.requestId, event.requestId!)));
    expect(inTransaction).toHaveLength(1);
    throw error;
  });
  await expect(runOperation(logFeedstockDelivery, fixture.ctx, fixture.input(), {
    audit: audit(), idempotency: { credentialId: "audit-credential", key: crypto.randomUUID() },
  })).rejects.toBe(error);
  expect(await rows()).toEqual([]);
  expect(await records()).toEqual([]);
  expect(await feedstockCount(fixture)).toBe(0);
});

it("does not record an execute failure and records form metadata without API credentials", async () => {
  const failing = { ...logFeedstockDelivery, execute: async () => { throw new Error("Injected write failure"); } };
  await expect(runOperation(failing, fixture.ctx, fixture.input(), { audit: audit() })).rejects.toThrow("Injected write failure");
  expect(await rows()).toEqual([]);
  const result = await runOperation(logFeedstockDelivery, fixture.ctx, fixture.input());
  const events = await db.select().from(activityEvents).where(and(
    eq(activityEvents.organizationId, fixture.ctx.organizationId),
    eq(activityEvents.operationId, logFeedstockDelivery.id),
  ));
  expect(events).toMatchObject([{
    entityId: result.data.feedstocks[0].id, source: "form", operationId: logFeedstockDelivery.id,
    versionBefore: null, versionAfter: 1, credentialId: null, oauthClientId: null,
  }]);
});

it("rejects an audited operation without describe before executing", async () => {
  const execute = vi.fn(logFeedstockDelivery.execute);
  await expect(runOperation({ ...logFeedstockDelivery, describe: undefined, execute }, fixture.ctx, fixture.input(), { audit: audit() }))
    .rejects.toThrow("Audited operations must describe their effect");
  expect(execute).not.toHaveBeenCalled();
});

it("returns update and delete effects with the actual versions and no identifier field names", async () => {
  const created = await runOperation(logFeedstockDelivery, fixture.ctx, fixture.input());
  const feedstockId = created.data.feedstocks[0].id;
  const updated = await runOperation(updateFeedstock, fixture.ctx, { feedstockId, expectedVersion: 1, notes: "Changed" }, { audit: audit() });
  expect(updated.effect).toEqual({ outcome: "updated", entityType: "feedstock", entityIds: [feedstockId], versionBefore: 1, versionAfter: 2, changedFields: ["notes"] });
  const deleted = await runOperation(deleteFeedstock, fixture.ctx, { feedstockId, expectedVersion: 2 }, { audit: audit() });
  expect(await rows()).toEqual(expect.arrayContaining([
    expect.objectContaining({ action: "updated", versionBefore: 1, versionAfter: 2, changedFields: ["notes"] }),
    expect.objectContaining({ action: "deleted", versionBefore: 2, versionAfter: null, changedFields: [] }),
  ]));
  expect(deleted.effect).toEqual({ outcome: "deleted", entityType: "feedstock", entityIds: [feedstockId], versionBefore: 2, versionAfter: null, changedFields: [] });
});

it("answers replay_unavailable for a v1 stored outcome without executing or auditing", async () => {
  const input = fixture.input();
  const options = { audit: audit(), idempotency: { credentialId: "audit-credential", key: crypto.randomUUID() } };
  await runOperation(logFeedstockDelivery, fixture.ctx, input, options);
  await db.update(apiIdempotencyRecords).set({ outcomeSchemaVersion: 1, outcome: { kind: "success", data: {} } })
    .where(eq(apiIdempotencyRecords.organizationId, fixture.ctx.organizationId));
  await expect(runOperation(logFeedstockDelivery, fixture.ctx, input, options)).rejects.toMatchObject({ code: "replay_unavailable" });
  expect(await rows()).toHaveLength(1);
  expect(await feedstockCount(fixture)).toBe(1);
});

it("records the OAuth client for an MCP runner write", async () => {
  const oauthClientId = "audit-oauth-client";
  await runOperation(logFeedstockDelivery, fixture.ctx, fixture.input(), {
    audit: { ...audit(), transport: "mcp", oauthClientId },
  });
  expect(await rows()).toMatchObject([{
    source: "mcp", oauthClientId, operationId: logFeedstockDelivery.id,
    credentialId: "audit-credential", versionBefore: null, versionAfter: 1,
  }]);
});

it.each(["empty entities", "empty scopes"] as const)("rolls back an audited write with %s", async (mode) => {
  const operation = {
    ...logFeedstockDelivery,
    execute: async (...args: Parameters<typeof logFeedstockDelivery.execute>) => {
      const result = await logFeedstockDelivery.execute(...args);
      if (mode === "empty scopes") {
        for (const item of result.feedstocks) args[0].activity.scope(item.id, []);
      }
      return result;
    },
    describe: (...args: Parameters<NonNullable<typeof logFeedstockDelivery.describe>>) => ({
      ...logFeedstockDelivery.describe!(...args)!,
      ...(mode === "empty entities" ? { entityIds: [] } : {}),
    }),
  };
  await expect(runOperation(operation, fixture.ctx, fixture.input(), {
    audit: audit(), idempotency: { credentialId: "audit-credential", key: crypto.randomUUID() },
  })).rejects.toThrow("Audited operation recorded no activity");
  expect(await db.select().from(activityEvents).where(eq(activityEvents.organizationId, fixture.ctx.organizationId))).toEqual([]);
  expect(await records()).toEqual([]);
  expect(await feedstockCount(fixture)).toBe(0);

  await runOperation(operation, fixture.ctx, fixture.input());
  expect(await feedstockCount(fixture)).toBe(1);
});

it("stores mass and link changes but only the note name, and omits re-sent unchanged fields", async () => {
  const created = await runOperation(logFeedstockDelivery, fixture.ctx, fixture.input());
  const before = created.data.feedstocks[0];
  const { suppliers } = await import("@/db/schema");
  const [supplier] = await db.insert(suppliers).values({ organizationId: fixture.ctx.organizationId, code: "AUDIT-NEXT", name: "Private supplier name" }).returning();
  const notes = "Private activity change note";
  const massWetKg = before.massWetKg + MASS_INCREMENT_KG;
  const updated = await runOperation(updateFeedstock, fixture.ctx, {
    feedstockId: before.id, expectedVersion: before.version, massWetKg, supplierId: supplier.id, notes, code: before.code,
  }, { audit: audit() });
  const events = await rows();
  expect(events).toHaveLength(1);
  expect(events[0].changes).toMatchObject({
    massWetKg: { from: String(before.massWetKg), to: String(massWetKg) },
    supplierId: { from: before.supplierId, to: supplier.id },
  });
  expect(events[0].changedFields).toEqual(["massDryKg", "massWetKg", "notes", "supplierId", "transportDistanceKm", "transportDistanceSource"]);
  expect(updated.effect?.changedFields).toEqual(events[0].changedFields);
  expect(updated.effect).not.toHaveProperty("changes");
  expect(events[0].changes).not.toHaveProperty("notes");
  expect(stringifyWithBigint(events)).not.toContain(notes);
  expect(stringifyWithBigint(events)).not.toContain(supplier.name);
});

it("rolls back an updated mass and its captured values together", async () => {
  const created = await runOperation(logFeedstockDelivery, fixture.ctx, fixture.input());
  const before = created.data.feedstocks[0];
  const { feedstocks } = await import("@/db/schema");
  const write = auditWriter.recordActivity;
  const failure = new Error("Abort captured update");
  vi.spyOn(auditWriter, "recordActivity").mockImplementation(async (ctx, tx, event) => {
    await write(ctx, tx, event);
    if (event.operationId === updateFeedstock.id) {
      expect(event.changes).toHaveProperty("massWetKg");
      throw failure;
    }
  });
  await expect(runOperation(updateFeedstock, fixture.ctx, {
    feedstockId: before.id, expectedVersion: before.version, massWetKg: before.massWetKg + MASS_INCREMENT_KG,
  }, { audit: audit() })).rejects.toBe(failure);
  expect(await rows()).toEqual([]);
  const [stored] = await db.select().from(feedstocks).where(and(eq(feedstocks.organizationId, fixture.ctx.organizationId), eq(feedstocks.id, before.id)));
  expect(stored).toMatchObject({ massWetKg: before.massWetKg, version: before.version });
});
