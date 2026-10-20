import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/db";
import { activityEvents, certifierProjects, creditBatches, facilities, feedstockTypes, productionProcesses, removalTemplateObservations } from "@/db/schema";
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
const scope = () => and(eq(certifierProjects.organizationId, ctx.organizationId), eq(certifierProjects.facilityId, facilityId));
beforeAll(async () => { await ensureTestOrg(); });
beforeEach(async () => {
  vi.clearAllMocks();
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
    answers: Object.fromEntries(entry.plan.decisions.map((decision) => [decision.id, decision.options[0].id])), overrides: {}, makeDefault: true, batches: [] };
}
async function batch() {
  const [row] = await db.insert(creditBatches).values({ organizationId: ctx.organizationId, facilityId, feedstockTypeId, productionProcessId, code: `CB-${randomUUID()}`, startDate: "2026-01-01", endDate: "2026-01-31" }).returning();
  return row;
}
async function expectUnapplied() {
  expect((await db.select().from(certifierProjects).where(scope()))[0].defaultRemovalTemplateId).toBeNull();
  const rows = await db.select().from(removalTemplateObservations).where(and(eq(removalTemplateObservations.organizationId, ctx.organizationId), eq(removalTemplateObservations.externalTemplateId, template.id)));
  expect(rows.every((row) => !Object.values(row.lineSources).some((source) => source.origin === "reviewed"))).toBe(true);
  expect(await db.select().from(activityEvents).where(and(eq(activityEvents.organizationId, ctx.organizationId), eq(activityEvents.facilityId, facilityId)))).toHaveLength(0);
}

it("rejects Member before any registry read", async () => {
  vi.mocked(requireOrgContext).mockResolvedValue({ ...ctx, orgRole: "member" });
  expect((await applyRemovalTemplateSetup({} as ApplyRemovalTemplateSetupInput)).success).toBe(false);
  expect(listGhgEntryTemplates).not.toHaveBeenCalled();
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
it("a batch held by a Removal rolls back default and decisions", async () => {
  await withLineageFixture(async (fixture) => {
    const originalFacility = facilityId;
    facilityId = fixture.facilityId;
    await db.insert(certifierProjects).values({ organizationId: ctx.organizationId, facilityId, provider: "isometric", externalProjectId: template.project_id, externalFacilityId: `fcl_${randomUUID()}` });
    try {
      await db.update(creditBatches).set({ removalTemplateId: null }).where(eq(creditBatches.id, fixture.batchId));
      const [held] = await db.select().from(creditBatches).where(eq(creditBatches.id, fixture.batchId));
      const planned = await input();
      planned.batches = [{ id: held.id, expectedVersion: held.version }];
      expect(await applyRemovalTemplateSetup(planned)).toMatchObject({ success: false, code: "certification_locked" });
      await expectUnapplied();
    } finally {
      await db.delete(certifierProjects).where(scope());
      facilityId = originalFacility;
    }
  }, "removal");
});
it("a pin added after load is stale even when the version was not incremented", async () => {
  const row = await batch();
  const planned = await input();
  planned.batches = [{ id: row.id, expectedVersion: row.version }];
  await db.update(creditBatches).set({ removalTemplateId: "other-template" }).where(eq(creditBatches.id, row.id));
  expect(await applyRemovalTemplateSetup(planned)).toMatchObject({ success: false, code: "stale_version", conflict: { id: row.id } });
  await expectUnapplied();
});
it("makes the template ready, sets the default and pins N batches with N events", async () => {
  const rows = [await batch(), await batch()];
  const planned = await input();
  planned.batches = rows.map(({ id, version }) => ({ id, expectedVersion: version }));
  expect(await applyRemovalTemplateSetup(planned)).toMatchObject({ success: true, data: { batchesUpdated: rows.length } });
  expect((await db.select().from(certifierProjects).where(scope()))[0].defaultRemovalTemplateId).toBe(template.id);
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
