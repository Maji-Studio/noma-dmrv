import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/db";
import { activityEvents, certifierProjects, creditBatches, facilities, feedstockTypes, productionProcesses, removalTemplateObservations, users } from "@/db/schema";
import { applyRemovalTemplateSetup, loadRemovalTemplateSetup } from "@/fn/certification/removal-template-setup";
import { requireOrgContext } from "@/lib/auth/server";
import { listGhgEntryTemplates } from "@/lib/isometric";
import { loadTemplateEnrichment } from "@/lib/isometric/template-observations/load-enrichment";
import { normalizeTemplateDefinition, validateLineSources, type TemplateEnrichment } from "@/lib/isometric/template-observations";
import { protocolDefaultFixture } from "@/lib/certification/removal-template-setup-test-fixtures";
import { ensureTestOrg, makeTestOrgContext, TEST_SITE_POSITION } from "./helpers/test-org";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import enrichmentFixture from "./fixtures/isometric/sandbox-enrichment-2026-10-15.json";
import type { ApplyRemovalTemplateSetupInput } from "@/schemas/removal-template-setup";

// Real transactions and guards; only session resolution and registry transport are mocked.
vi.mock("@/lib/auth/server", async (original) => ({ ...await original<typeof import("@/lib/auth/server")>(), requireOrgContext: vi.fn() }));
vi.mock("@/data-access/certifier-credentials", () => ({ resolveIsometricClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/isometric", async (original) => ({ ...await original<typeof import("@/lib/isometric")>(), listGhgEntryTemplates: vi.fn(), listComponentBlueprints: vi.fn(async () => []), listProjects: vi.fn(async () => []) }));
vi.mock("@/lib/isometric/template-observations/load-enrichment", () => ({ loadTemplateEnrichment: vi.fn() }));

const ctx = makeTestOrgContext();
let facilityId: string;
let feedstockTypeId: string;
let productionProcessId: string;
let template: ReturnType<typeof protocolDefaultFixture>;
let secondAdminId: string | null;
const scope = () => and(eq(certifierProjects.organizationId, ctx.organizationId), eq(certifierProjects.facilityId, facilityId));
beforeAll(async () => {
  await ensureTestOrg();
  // Apply records who reviewed the decisions; the reviewer must exist even when this file runs alone.
  await db.insert(users).values({ id: ctx.userId, email: `${ctx.userId}@example.test` }).onConflictDoNothing();
});
beforeEach(async () => {
  vi.clearAllMocks();
  secondAdminId = null;
  vi.mocked(requireOrgContext).mockResolvedValue({ ...ctx, orgRole: "admin" });
  const tag = randomUUID();
  const [facility] = await db.insert(facilities).values({ ...TEST_SITE_POSITION, organizationId: ctx.organizationId, timezone: "UTC", code: `SETUP-${tag}`, name: `Setup ${tag}` }).returning();
  facilityId = facility.id;
  const [feedstock] = await db.insert(feedstockTypes).values({ organizationId: ctx.organizationId, code: `SETUP-${tag}`, name: `Setup ${tag}`, category: "forestry", usage: "pyrolysis" }).returning();
  feedstockTypeId = feedstock.id;
  const [process] = await db.insert(productionProcesses).values({ organizationId: ctx.organizationId, facilityId, feedstockTypeId }).returning();
  productionProcessId = process.id;
  template = protocolDefaultFixture();
  template.id = `setup-${tag}`;
  await db.insert(certifierProjects).values({ organizationId: ctx.organizationId, facilityId, provider: "isometric", externalProjectId: template.project_id, externalFacilityId: `fcl_${tag}` });
  vi.mocked(listGhgEntryTemplates).mockImplementation(async () => [template]);
  const datapoints = enrichmentFixture.datapoints as Record<string, { quantity: { unit: string; magnitude: number } }>;
  const enrichment: TemplateEnrichment = Object.fromEntries(normalizeTemplateDefinition(template).groups.flatMap((group) => group.components.map((component) => [component.id,
    Object.fromEntries(component.inputs.map((input) => {
      if (input.type === "fixed") {
        const quantity = datapoints[input.fixedDatapointId!].quantity;
        return [input.key, { unit: quantity.unit, fixedValue: quantity.magnitude }];
      }
      const blueprint = enrichmentFixture.blueprints.find((blueprint) => blueprint.key === component.blueprintKey)!;
      return [input.key, { unit: blueprint.inputs.find((candidate) => candidate.input_key === input.key)!.compatible_unit }];
    })),
  ])));
  vi.mocked(loadTemplateEnrichment).mockResolvedValue(enrichment);
});
afterEach(async () => {
  await db.delete(activityEvents).where(and(eq(activityEvents.organizationId, ctx.organizationId), eq(activityEvents.facilityId, facilityId)));
  await db.delete(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, facilityId)));
  await db.delete(removalTemplateObservations).where(and(eq(removalTemplateObservations.organizationId, ctx.organizationId), eq(removalTemplateObservations.externalTemplateId, template.id)));
  if (secondAdminId) await db.delete(users).where(eq(users.id, secondAdminId));
  await db.delete(certifierProjects).where(scope());
  await db.delete(productionProcesses).where(and(eq(productionProcesses.organizationId, ctx.organizationId), eq(productionProcesses.id, productionProcessId)));
  await db.delete(facilities).where(and(eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, facilityId)));
  await db.delete(feedstockTypes).where(and(eq(feedstockTypes.organizationId, ctx.organizationId), eq(feedstockTypes.id, feedstockTypeId)));
});
async function input(): Promise<ApplyRemovalTemplateSetupInput> {
  const result = await loadRemovalTemplateSetup(facilityId);
  if (!result.success) throw new Error(result.error);
  const entry = result.data.fitting[0];
  return { facilityId, removalTemplateId: template.id, fingerprints: { semanticFingerprint: entry.semanticFingerprint, fullFingerprint: entry.fullFingerprint },
    planFingerprint: entry.planFingerprint, answers: Object.fromEntries(entry.plan.decisions.map((decision) => [decision.id, decision.options[0].id])), overrides: {}, batchVersions: result.data.batchVersions };
}
async function batch() {
  const [row] = await db.insert(creditBatches).values({ organizationId: ctx.organizationId, facilityId, feedstockTypeId, productionProcessId, code: `CB-${randomUUID()}`, startDate: "2026-01-01", endDate: "2026-01-31" }).returning();
  return row;
}
async function expectUnapplied() {
  expect((await db.select().from(certifierProjects).where(scope()))[0].removalTemplateId).toBeNull();
  const rows = await db.select().from(removalTemplateObservations).where(and(eq(removalTemplateObservations.organizationId, ctx.organizationId), eq(removalTemplateObservations.externalTemplateId, template.id)));
  expect(rows.every((row) => !Object.values(row.lineSources).some((source) => source.origin === "reviewed"))).toBe(true);
  expect(await db.select().from(activityEvents).where(and(eq(activityEvents.organizationId, ctx.organizationId), eq(activityEvents.facilityId, facilityId)))).toHaveLength(0);
}

it("rejects Member before any registry read", async () => {
  const planned = await input();
  vi.mocked(requireOrgContext).mockResolvedValue({ ...ctx, orgRole: "member" });
  vi.mocked(listGhgEntryTemplates).mockClear();
  expect(await applyRemovalTemplateSetup(planned)).toMatchObject({ success: false, error: "You don't have permission to perform this action." });
  expect(listGhgEntryTemplates).not.toHaveBeenCalled();
  await expectUnapplied();
});
it("refuses a facility outside the session organization", async () => {
  const planned = await input();
  vi.mocked(listGhgEntryTemplates).mockClear();
  vi.mocked(requireOrgContext).mockResolvedValue({ ...ctx, organizationId: "other-setup-org", orgRole: "admin" });
  expect((await applyRemovalTemplateSetup(planned)).success).toBe(false);
  expect(listGhgEntryTemplates).not.toHaveBeenCalled();
  await expectUnapplied();
});
it("refuses an archived facility and rolls back decisions and default", async () => {
  const planned = await input();
  await db.update(facilities).set({ archivedAt: new Date() }).where(eq(facilities.id, facilityId));
  expect((await applyRemovalTemplateSetup(planned)).success).toBe(false);
  await expectUnapplied();
});
it("returns a conflict for a stale fingerprint", async () => {
  const planned = await input();
  template.groups[0].components[0].display_name += " changed";
  const result = await applyRemovalTemplateSetup(planned);
  expect(result).toMatchObject({ success: false, code: "stale_version", error: "The template changed in Isometric. Review it again.", conflict: { entity: "removal_template_observation" } });
  await expectUnapplied();
});
it("refuses a stale default-only preview after a second Admin changes a choice, preserving the default and batch pins", async () => {
  const pyrolysis = template.groups.find((group) => group.key === "pyrolysis")!;
  const electricity = pyrolysis.components.find((component) => component.blueprint_key === "grid_electricity_use")!;
  pyrolysis.components = [electricity];
  const row = await batch();
  const planned = await input();
  expect(planned.answers).toEqual({});
  const observationScope = and(eq(removalTemplateObservations.organizationId, ctx.organizationId), eq(removalTemplateObservations.externalTemplateId, template.id));
  // The first preview has no stored observation to use as a version precondition.
  expect(await db.select().from(removalTemplateObservations).where(observationScope)).toHaveLength(0);

  secondAdminId = `setup-admin-${randomUUID()}`;
  await db.insert(users).values({ id: secondAdminId, email: `${secondAdminId}@example.com` });
  vi.mocked(requireOrgContext).mockResolvedValue({ ...ctx, userId: secondAdminId, orgRole: "admin" });
  const changed = await input();
  changed.overrides = { [electricity.id]: "entry" };
  expect(await applyRemovalTemplateSetup(changed)).toMatchObject({ success: true });
  const [reviewed] = await db.select().from(removalTemplateObservations).where(observationScope);
  expect(reviewed.lineSources[electricity.id]).toMatchObject({ scope: "operating", entryPolicy: "additive", origin: "reviewed" });
  expect(reviewed.lineSources[electricity.id].automaticSource).toBeUndefined();
  const [mapping] = await db.select().from(certifierProjects).where(scope());
  expect(mapping.removalTemplateId).toBe(template.id);

  vi.mocked(requireOrgContext).mockResolvedValue({ ...ctx, orgRole: "admin" });
  expect(await applyRemovalTemplateSetup(planned)).toMatchObject({ success: false, code: "stale_version", conflict: { entity: "removal_template_observation" } });
  const [after] = await db.select().from(removalTemplateObservations).where(observationScope);
  expect(after.lineSources).toEqual(reviewed.lineSources);
  expect(after.version).toBe(reviewed.version);
  expect((await db.select().from(certifierProjects).where(scope()))[0]).toEqual(mapping);
  const [unpinned] = await db.select().from(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, row.id)));
  expect(unpinned.removalTemplateId).toBe(template.id);
  expect(unpinned.version).toBe(row.version + 1);
  expect(await db.select().from(activityEvents).where(and(eq(activityEvents.organizationId, ctx.organizationId), eq(activityEvents.facilityId, facilityId)))).toHaveLength(1);
});
it("keeps a sent Removal's batch and switches both an unassigned and an older-template batch", async () => {
  await withLineageFixture(async (fixture) => {
    const originalFacility = facilityId;
    facilityId = fixture.facilityId;
    await db.insert(certifierProjects).values({ organizationId: ctx.organizationId, facilityId, provider: "isometric", externalProjectId: template.project_id, externalFacilityId: `fcl_${randomUUID()}` });
    const extraIds: string[] = [];
    try {
      await db.update(creditBatches).set({ removalTemplateId: "sent-template" }).where(eq(creditBatches.id, fixture.batchId));
      const [held] = await db.select().from(creditBatches).where(eq(creditBatches.id, fixture.batchId));
      const rows = await db.insert(creditBatches).values([null, "older-template"].map((removalTemplateId) => ({
        organizationId: ctx.organizationId, facilityId, feedstockTypeId: fixture.feedstockTypeId,
        productionProcessId: fixture.productionProcessId, code: `CB-${randomUUID()}`,
        startDate: "2026-01-01", endDate: "2026-01-31", removalTemplateId,
      }))).returning();
      extraIds.push(...rows.map((row) => row.id));
      const planned = await input();
      const preview = await loadRemovalTemplateSetup(facilityId);
      if (!preview.success) throw new Error(preview.error);
      expect(preview.data.fitting[0].batchesThatSwitch.map((row) => row.id).sort()).toEqual([...extraIds].sort());
      expect(preview.data.fitting[0].batchesKept).toEqual([{ id: held.id, code: held.code, templateName: null, reason: "removalSent" }]);
      expect(await applyRemovalTemplateSetup(planned)).toMatchObject({ success: true, data: {
        batchesUpdated: 2, batchesKept: [{ id: held.id, code: held.code, reason: "removalSent" }],
      } });
      expect((await db.select().from(certifierProjects).where(scope()))[0].removalTemplateId).toBe(template.id);
      const stored = await db.select().from(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, facilityId)));
      expect(stored.find((row) => row.id === held.id)).toEqual(held);
      for (const row of rows) expect(stored.find((batch) => batch.id === row.id)).toMatchObject({ removalTemplateId: template.id, version: row.version + 1 });
      const events = await db.select().from(activityEvents).where(and(eq(activityEvents.organizationId, ctx.organizationId), eq(activityEvents.facilityId, facilityId)));
      expect(events).toHaveLength(2);
      expect(events.every((event) => extraIds.includes(event.entityId) && event.changedFields?.includes("removalTemplateId"))).toBe(true);
    } finally {
      await db.delete(activityEvents).where(and(eq(activityEvents.organizationId, ctx.organizationId), eq(activityEvents.facilityId, facilityId)));
      for (const id of extraIds) await db.delete(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, id)));
      await db.delete(certifierProjects).where(scope());
      facilityId = originalFacility;
    }
  }, "removal");
});
it("a pin added after load is stale even when the version was not incremented", async () => {
  const row = await batch();
  const planned = await input();
  await db.update(creditBatches).set({ removalTemplateId: "other-template" }).where(eq(creditBatches.id, row.id));
  expect(await applyRemovalTemplateSetup(planned)).toMatchObject({ success: false, code: "stale_version", conflict: { id: row.id } });
  await expectUnapplied();
});
it("makes the template ready, sets the default and pins N batches with N events", async () => {
  const rows = [await batch(), await batch()];
  const planned = await input();
  expect(await applyRemovalTemplateSetup(planned)).toMatchObject({ success: true, data: { batchesUpdated: rows.length } });
  expect((await db.select().from(certifierProjects).where(scope()))[0].removalTemplateId).toBe(template.id);
  const [observation] = await db.select().from(removalTemplateObservations).where(and(eq(removalTemplateObservations.organizationId, ctx.organizationId), eq(removalTemplateObservations.externalTemplateId, template.id)));
  expect(validateLineSources(observation.definition, observation.lineSources)).toEqual([]);
  expect(Object.values(observation.lineSources).every((source) => source.origin === "reviewed")).toBe(true);
  const loaded = await loadRemovalTemplateSetup(facilityId);
  if (!loaded.success) throw new Error(loaded.error);
  expect(loaded.data.fitting.find((entry) => entry.id === template.id)?.ready).toBe(true);
  const pinned = await db.select().from(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, facilityId)));
  expect(pinned.every((row) => row.removalTemplateId === template.id)).toBe(true);
  const events = await db.select().from(activityEvents).where(and(eq(activityEvents.organizationId, ctx.organizationId), eq(activityEvents.facilityId, facilityId)));
  expect(events).toHaveLength(rows.length);
  expect(new Set(events.map((event) => event.entityId))).toEqual(new Set(rows.map((row) => row.id)));
});
it("rolls back setup for a stale mutable batch version", async () => {
  const row = await batch();
  const planned = await input();
  await db.update(creditBatches).set({ version: row.version + 1 }).where(eq(creditBatches.id, row.id));
  expect(await applyRemovalTemplateSetup(planned)).toMatchObject({ success: false, code: "stale_version", conflict: { id: row.id } });
  await expectUnapplied();
});

it("keeps archived and already-current batches without activity or version changes", async () => {
  const archived = await batch();
  const current = await batch();
  await db.update(creditBatches).set({ archivedAt: new Date(), removalTemplateId: "older-template" }).where(eq(creditBatches.id, archived.id));
  await db.update(creditBatches).set({ removalTemplateId: template.id }).where(eq(creditBatches.id, current.id));
  const planned = await input();
  expect(await applyRemovalTemplateSetup(planned)).toMatchObject({ success: true, data: {
    batchesUpdated: 0, batchesKept: [{ id: archived.id, reason: "archived" }],
  } });
  const rows = await db.select().from(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, facilityId)));
  expect(rows.find((row) => row.id === archived.id)).toMatchObject({ removalTemplateId: "older-template", version: archived.version });
  expect(rows.find((row) => row.id === current.id)).toMatchObject({ removalTemplateId: template.id, version: current.version });
  expect(await db.select().from(activityEvents).where(and(eq(activityEvents.organizationId, ctx.organizationId), eq(activityEvents.facilityId, facilityId)))).toHaveLength(0);
});
