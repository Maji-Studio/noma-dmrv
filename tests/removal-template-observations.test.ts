import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, facilities, organizations, users, removalTemplateObservations } from "@/db/schema";
import { getLatestTemplateObservation, getTemplateObservationById, observeTemplate, reviewLineContracts } from "@/data-access/removal-template-observations";
import { normalizeTemplateDefinition, type GhgEntryTemplate, type TemplateEnrichment } from "@/lib/isometric/template-observations";
import fixture from "./fixtures/isometric/sandbox-template-2026-10-15.json";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID, TEST_SITE_POSITION } from "./helpers/test-org";

// DB-backed: the supervisor generates/applies the schema migration before running.
const tag = crypto.randomUUID();
const userId = `template-review-${tag}`;
const ctx = makeTestOrgContext(userId);
const otherOrgId = `template-observation-other-${tag}`;
const otherCtx = { ...ctx, organizationId: otherOrgId };
const templateIds: string[] = [];
/** A blocked statement fails after this long; an unblocked one finishes in a few ms. */
const LOCK_TIMEOUT_MS = 1500;
const BLOCKED_PROBE_MS = 300;
const heldObservations: ReturnType<typeof observeTemplate>[] = [];
const lockFacilityCode = `FAC-LOCK-${tag.slice(0, 8)}`;

function template(): GhgEntryTemplate {
  const value = structuredClone(fixture) as GhgEntryTemplate;
  value.id = `rvt_test_${crypto.randomUUID()}`;
  // One ordinary monitored line, with no fixed datapoints to read.
  const group = value.groups.find((group) => group.key === "pyrolysis")!;
  group.components = [group.components.find((component) => component.blueprint_key === "grid_electricity_use")!];
  group.components[0].inputs = group.components[0].inputs.filter((input) => input.type === "monitored");
  value.groups = [group];
  templateIds.push(value.id);
  return value;
}
function enrichment(value: GhgEntryTemplate): TemplateEnrichment {
  return Object.fromEntries(value.groups.flatMap((group) => group.components.map((component) => [
    component.id, Object.fromEntries(component.inputs.map((input) => [input.input_key, { unit: "kWh", deprecated: null }])),
  ])));
}
function observe(value: GhgEntryTemplate, organization = ctx) {
  return observeTemplate(organization, { provider: "isometric", externalProjectId: value.project_id, template: value, enrichment: enrichment(value) });
}

beforeAll(async () => {
  await ensureTestOrg();
  await db.insert(users).values({ id: userId, email: `${tag}@template-observation.test`, emailVerified: true });
  await db.insert(organizations).values({ id: otherOrgId, name: "Template observation isolation", slug: otherOrgId });
});
afterAll(async () => {
  if (templateIds.length) await db.delete(removalTemplateObservations).where(and(
    inArray(removalTemplateObservations.organizationId, [TEST_ORG_ID, otherOrgId]),
    inArray(removalTemplateObservations.externalTemplateId, templateIds),
  ));
  await db.delete(activityEvents).where(eq(activityEvents.actorUserId, userId));
  await db.delete(facilities).where(and(eq(facilities.organizationId, TEST_ORG_ID), eq(facilities.code, lockFacilityCode)));
  await db.delete(organizations).where(eq(organizations.id, otherOrgId));
  await db.delete(users).where(eq(users.id, userId));
});

describe("org-scoped template observations", () => {
  it("inserts once and only bumps lastObservedAt on an unchanged read", async () => {
    const value = template();
    const first = await observe(value);
    const second = await observe(value);
    expect(second.id).toBe(first.id);
    expect(second.lastObservedAt.getTime()).toBeGreaterThan(first.lastObservedAt.getTime());
    expect(second.firstObservedAt).toEqual(first.firstObservedAt);
    expect(second.updatedAt).toEqual(first.updatedAt);
    expect(second.version).toBe(first.version);
    expect(second.definition).toEqual(normalizeTemplateDefinition(value));
  });
  it("carries surviving reviewed contracts and restores them when an old row reappears", async () => {
    const value = template();
    value.groups[0].components[0].id = `new_carried_${tag}`;
    const original = await observe(value);
    const changed = structuredClone(value);
    const component = changed.groups[0].components[0];
    component.display_name = "Renamed electricity";
    const newer = await observe(changed);
    expect(newer.id).not.toBe(original.id);
    expect(newer.lineSources[component.id].automaticSource).toBe("run-electricity");
    // A review opened on the superseded row would never reach compilation.
    await expect(reviewLineContracts(ctx, { observationId: original.id, expectedVersion: original.version, assignments: {} }))
      .rejects.toMatchObject({ code: "stale_version" });
    const reviewed = await reviewLineContracts(ctx, {
      observationId: newer.id, expectedVersion: newer.version,
      assignments: { [component.id]: { scope: "operating", automaticSource: "run-electricity", entryPolicy: "none" } },
    });
    const restored = await observe(value);
    expect(restored.id).toBe(original.id);
    expect(restored.lineSources[component.id]).toEqual({ ...reviewed.lineSources[component.id], origin: "carried" });
    expect(restored.version).toBe(original.version + 1);
  });
  it("serializes concurrent first upserts into one observation", async () => {
    const value = template();
    const rows = await Promise.all(Array.from({ length: 4 }, () => observe(value)));
    expect(new Set(rows.map((row) => row.id)).size).toBe(1);
    expect((await getLatestTemplateObservation(ctx, "isometric", value.id))?.id).toBe(rows[0].id);
  });
  it("isolates reads, reviews and upserts by organization", async () => {
    const value = template();
    const row = await observe(value);
    expect(await getTemplateObservationById(otherCtx, row.id)).toBeNull();
    expect(await getLatestTemplateObservation(otherCtx, "isometric", value.id)).toBeNull();
    await expect(reviewLineContracts(otherCtx, { observationId: row.id, expectedVersion: row.version, assignments: {} })).rejects.toThrow("not found");
    const other = await observe(value, otherCtx);
    expect(other.id).not.toBe(row.id);
    expect(other.organizationId).toBe(otherOrgId);
  });
  it("rejects stale reviews and invalid contracts; accepts a proposal unchanged", async () => {
    const value = template();
    const component = value.groups[0].components[0];
    component.id = `new_${tag}`;
    const row = await observe(value);
    expect(row.lineSources[component.id].origin).toBe("proposed");
    await expect(reviewLineContracts(ctx, { observationId: row.id, expectedVersion: row.version, assignments: {
      [component.id]: { scope: "operating", automaticSource: "run-startup-diesel", entryPolicy: "additive" },
    } })).rejects.toThrow("valid, distinct");
    const { scope, automaticSource, entryPolicy } = row.lineSources[component.id];
    const reviewed = await reviewLineContracts(ctx, { observationId: row.id, expectedVersion: row.version,
      assignments: { [component.id]: { scope, automaticSource, entryPolicy } },
    });
    expect(reviewed.lineSources[component.id].origin).toBe("reviewed");
    expect(reviewed.reviewedByUserId).toBe(userId);
    await expect(reviewLineContracts(ctx, { observationId: row.id, expectedVersion: row.version, assignments: {} }))
      .rejects.toMatchObject({ code: "stale_version" });
  });
  it("refuses review until every input was read", async () => {
    const value = template();
    const row = await observeTemplate(ctx, { provider: "isometric", externalProjectId: value.project_id, template: value, enrichment: {} });
    await expect(reviewLineContracts(ctx, { observationId: row.id, expectedVersion: row.version, assignments: {} }))
      .rejects.toThrow("Template not fully read. Try again.");
  });
  describe("per-template observation lock", () => {
    // Same key as acquireTemplateObservationLock in removal-template-observations.ts.
    const lockKey = (templateId: string) => JSON.stringify(["removal-template-observation", TEST_ORG_ID, "isometric", templateId]);
    async function holdingLock<T>(templateId: string, work: () => Promise<T>): Promise<T> {
      let release!: () => void;
      const released = new Promise<void>((resolve) => { release = resolve; });
      let acquired!: () => void;
      const ready = new Promise<void>((resolve) => { acquired = resolve; });
      const holder = db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey(templateId)}, 0))`);
        acquired();
        await released;
      });
      try {
        await ready;
        return await work();
      } finally {
        release();
        await holder;
      }
    }
    const withLockTimeout = <T,>(fn: () => Promise<T>) => Promise.race([
      fn(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("blocked on the held lock")), LOCK_TIMEOUT_MS)),
    ]);

    it("blocks the same template while held (confirms the lock key)", async () => {
      const value = template();
      await holdingLock(value.id, async () => {
        const pending = observe(value);
        const outcome = await Promise.race([pending.then(() => "done"), new Promise((resolve) => setTimeout(() => resolve("waiting"), BLOCKED_PROBE_MS))]);
        expect(outcome).toBe("waiting");
        // Released in holdingLock's finally; surface the eventual result afterwards.
        heldObservations.push(pending);
      });
      const [row] = await Promise.all(heldObservations.splice(0));
      expect(row.externalTemplateId).toBe(value.id);
    });
    it("does not block org-scoped inserts while a template observation is held", async () => {
      const value = template();
      await holdingLock(value.id, async () => {
        const [facility] = await withLockTimeout(() => db.insert(facilities).values({ ...TEST_SITE_POSITION, organizationId: TEST_ORG_ID, timezone: "UTC", code: lockFacilityCode, name: "Observation lock" }).returning());
        await withLockTimeout(() => db.insert(activityEvents).values({ organizationId: TEST_ORG_ID, facilityId: facility.id, entityType: "credit_batch", entityId: facility.id, action: "created", source: "form", actorUserId: userId }));
      });
    });
    it("does not block an observation of a different template in the same org", async () => {
      const held = template();
      const other = template();
      await holdingLock(held.id, async () => {
        const row = await withLockTimeout(() => observe(other));
        expect(row.externalTemplateId).toBe(other.id);
      });
    });
  });
});
