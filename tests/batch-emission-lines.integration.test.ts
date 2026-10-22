import { assert, afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches, creditBatchProductionRuns, emissionEntries, emissionEntryValues, emissionLineComments, productionRuns, removalTemplateObservations } from "@/db/schema";
import { observeTemplate } from "@/data-access/removal-template-observations";
import { loadBatchEmissionLines } from "@/lib/read-models/batch-emission-lines";
import { loadBatchesEmissionLines } from "@/lib/read-models/batches-emission-lines";
import { loadTemplateEnrichment } from "@/lib/isometric/template-observations/load-enrichment";
import { getDatapoint } from "@/lib/isometric/submissions";
import type { IsometricClient } from "@/lib/isometric/client";
import type { IsometricComponentBlueprint } from "@/lib/isometric/projects";
import enrichmentFixture from "./fixtures/isometric/sandbox-enrichment-2026-10-15.json";
import type { GhgEntryTemplate } from "@/lib/isometric/template-observations";
import fixture from "./fixtures/isometric/sandbox-template-2026-10-15.json";
import { createLineageFixture, cleanupLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

// Only the registry boundary below the real loadTemplateEnrichment is stubbed.
vi.mock("@/lib/isometric/submissions", async (original) => ({
  ...await original<typeof import("@/lib/isometric/submissions")>(), getDatapoint: vi.fn(),
}));

// Real Postgres suite; tests/setup.ts loads .env.test and enforces the throwaway DB.
// Intentionally not run in the implementation sandbox.
const ctx = makeTestOrgContext();
const template = structuredClone(fixture) as GhgEntryTemplate;
template.id = `rvt_batch_lines_${crypto.randomUUID()}`;
const group = template.groups.find((group) => group.key === "pyrolysis")!;
group.components = group.components.filter((component) => component.blueprint_key === "grid_electricity_use");
group.components[0].inputs = group.components[0].inputs.filter((input) => input.type === "monitored");
template.groups = [group];
const unreadTemplateId = `rvt_unread_${crypto.randomUUID()}`;
const incompleteTemplate = structuredClone(template);
incompleteTemplate.id = `rvt_incomplete_${crypto.randomUUID()}`;
const originalElectricity = (fixture as GhgEntryTemplate).groups.flatMap(group => group.components)
  .find(component => component.id === group.components[0].id)!;
incompleteTemplate.groups[0].components[0].inputs = structuredClone(originalElectricity.inputs);
const registryClient = {} as IsometricClient;
const blueprints = enrichmentFixture.blueprints as IsometricComponentBlueprint[];
let observationId: string;
let storedEntryId: string | undefined;
let lineage: LineageFixture;
let foreignBatch: LineageFixture;
let unappliedRunId: string;

beforeAll(async () => {
  await ensureTestOrg();
  lineage = await createLineageFixture("none");
  foreignBatch = await createLineageFixture("none");
  const observation = await observeTemplate(ctx, { provider: "isometric", externalProjectId: template.project_id, template,
    enrichment: await loadTemplateEnrichment(registryClient, template, blueprints) });
  observationId = observation.id;
  await db.update(creditBatches).set({ removalTemplateId: template.id }).where(and(eq(creditBatches.organizationId, TEST_ORG_ID), eq(creditBatches.id, lineage.batchId)));
  const [run] = await db.update(productionRuns).set({ status: "complete", endTime: new Date("2026-06-13T12:00:00Z"), electricityKwh: 12 })
    .where(and(eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.id, lineage.productionRunId))).returning();
  // A second run on the same reactor needs its own start time and posting sequence.
  const [unapplied] = await db.insert(productionRuns).values({ ...run, stockPostingSequence: undefined, id: crypto.randomUUID(), code: `PR-EL-${crypto.randomUUID()}`, electricityKwh: 8,
    startTime: new Date("2026-06-14T08:00:00Z"), endTime: new Date("2026-06-14T12:00:00Z") }).returning();
  unappliedRunId = unapplied.id;
  await db.insert(creditBatchProductionRuns).values({ organizationId: TEST_ORG_ID, creditBatchId: lineage.batchId, productionRunId: unapplied.id });
  await db.update(productionRuns).set({ electricityKwh: 99 }).where(and(eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.id, foreignBatch.productionRunId)));
});
beforeEach(async () => {
  vi.mocked(getDatapoint).mockReset();
  await db.update(creditBatches).set({ removalTemplateId: template.id }).where(and(
    eq(creditBatches.organizationId, TEST_ORG_ID), eq(creditBatches.id, lineage.batchId),
  ));
});
afterEach(async () => {
  if (storedEntryId) {
    await db.delete(emissionEntryValues).where(and(eq(emissionEntryValues.organizationId, TEST_ORG_ID), eq(emissionEntryValues.entryId, storedEntryId)));
    await db.delete(emissionEntries).where(and(eq(emissionEntries.organizationId, TEST_ORG_ID), eq(emissionEntries.id, storedEntryId)));
    storedEntryId = undefined;
  }
  await db.delete(emissionLineComments).where(and(eq(emissionLineComments.organizationId, TEST_ORG_ID), eq(emissionLineComments.creditBatchId, lineage.batchId)));
});
afterAll(async () => {
  if (unappliedRunId) {
    await db.delete(creditBatchProductionRuns).where(and(eq(creditBatchProductionRuns.organizationId, TEST_ORG_ID), eq(creditBatchProductionRuns.productionRunId, unappliedRunId)));
    await db.delete(productionRuns).where(and(eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.id, unappliedRunId)));
  }
  if (lineage) await cleanupLineageFixture(lineage);
  if (foreignBatch) await cleanupLineageFixture(foreignBatch);
  for (const id of [template.id, incompleteTemplate.id]) {
    await db.delete(removalTemplateObservations).where(and(eq(removalTemplateObservations.organizationId, TEST_ORG_ID), eq(removalTemplateObservations.externalTemplateId, id)));
  }
});
it("loads pinned lines using all and only the batch's runs, including unapplied output", async () => {
  const linesResult = await loadBatchEmissionLines(ctx, lineage.facilityId, lineage.batchId);
  assert(linesResult.status === "ready");
  const lines = linesResult.lines;
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ componentId: group.components[0].id, state: "filled", automaticFigure: { magnitude: "20", unit: "kWh" }, total: { magnitude: "20", unit: "kWh" }, entries: [], comment: null });
});
it("rejects a cross-organization batch read", async () => {
  await expect(loadBatchEmissionLines({ ...ctx, organizationId: `other-${crypto.randomUUID()}` }, lineage.facilityId, lineage.batchId)).rejects.toThrow();
});
it("returns a blocker for an unpinned batch", async () => {
  await expect(loadBatchEmissionLines(ctx, foreignBatch.facilityId, foreignBatch.batchId)).resolves.toEqual({
    status: "blocked", blocker: "unpinnedTemplate", storedEntries: [],
  });
});

async function pin(templateId: string) {
  await db.update(creditBatches).set({ removalTemplateId: templateId }).where(and(
    eq(creditBatches.organizationId, TEST_ORG_ID), eq(creditBatches.id, lineage.batchId),
  ));
}
async function bothLoaders(templateId: string) {
  const single = await loadBatchEmissionLines(ctx, lineage.facilityId, lineage.batchId);
  const set = await loadBatchesEmissionLines(ctx, [{ id: lineage.batchId, removalTemplateId: templateId }]);
  return [single, set.get(lineage.batchId)!];
}

it("blocks both loaders when a pinned template has no observation", async () => {
  await pin(unreadTemplateId);
  for (const result of await bothLoaders(unreadTemplateId)) {
    expect(result).toEqual({ status: "blocked", blocker: "templateNotFullyRead", storedEntries: [] });
  }
});

it("keeps incomplete observations ready with explicit review lines in both loaders", async () => {
  vi.mocked(getDatapoint).mockRejectedValue(new Error("Registry read unavailable"));
  const enrichment = await loadTemplateEnrichment(registryClient, incompleteTemplate, blueprints);
  expect(enrichment[group.components[0].id].grid_carbon_intensity).toEqual({ status: "unknown" });
  expect(getDatapoint).toHaveBeenCalledExactlyOnceWith(registryClient, originalElectricity.inputs.find(input => input.type === "fixed")!.datapoint_id);
  await observeTemplate(ctx, { provider: "isometric", externalProjectId: incompleteTemplate.project_id,
    template: incompleteTemplate, enrichment });
  await pin(incompleteTemplate.id);
  for (const result of await bothLoaders(incompleteTemplate.id)) {
    assert(result.status === "ready");
    expect(result.storedEntries).toEqual([]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ componentId: group.components[0].id, state: "needsReview",
      blocker: { code: "templateNotFullyRead" }, automaticFigure: { magnitude: "20", unit: "kWh" } });
  }
});

it("retains stored entries when the batch's current template is unread", async () => {
  const [entry] = await db.insert(emissionEntries).values({ organizationId: TEST_ORG_ID,
    creditBatchId: lineage.batchId, removalTemplateId: template.id, componentId: group.components[0].id,
    inputShape: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }],
    lineRule: "additive", observationId, kind: "value", occurredOn: "2026-06-13" }).returning();
  storedEntryId = entry.id;
  await db.insert(emissionEntryValues).values({ organizationId: TEST_ORG_ID, entryId: entry.id,
    inputKey: "electricity_use", magnitude: "2", unit: "kWh" });
  await pin(unreadTemplateId);
  for (const result of await bothLoaders(unreadTemplateId)) {
    expect(result).toMatchObject({ status: "blocked", blocker: "templateNotFullyRead", storedEntries: [
      { id: entry.id, occurredOn: "2026-06-13", values: [{ magnitude: "2", unit: "kWh" }] },
    ] });
    expect(result.storedEntries).toHaveLength(1);
  }
});

it("returns identical ready lines with a retired entry through both loaders, ignoring optional comments", async () => {
  const previousTemplate = structuredClone(template);
  const retiredComponentId = `${group.components[0].id}_retired`;
  previousTemplate.groups[0].components[0].id = retiredComponentId;
  const previous = await observeTemplate(ctx, { provider: "isometric", externalProjectId: previousTemplate.project_id,
    template: previousTemplate, enrichment: await loadTemplateEnrichment(registryClient, previousTemplate, blueprints) });
  const [entry] = await db.insert(emissionEntries).values({ organizationId: TEST_ORG_ID,
    creditBatchId: lineage.batchId, removalTemplateId: template.id, componentId: retiredComponentId,
    inputShape: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }],
    lineRule: "additive", observationId: previous.id, kind: "value", occurredOn: "2026-06-13" }).returning();
  storedEntryId = entry.id;
  await db.insert(emissionEntryValues).values({ organizationId: TEST_ORG_ID, entryId: entry.id,
    inputKey: "electricity_use", magnitude: "2", unit: "kWh" });
  const current = await observeTemplate(ctx, { provider: "isometric", externalProjectId: template.project_id,
    template, enrichment: await loadTemplateEnrichment(registryClient, template, blueprints) });
  expect(current.id).not.toBe(previous.id);
  await db.insert(emissionLineComments).values({ organizationId: TEST_ORG_ID,
    creditBatchId: lineage.batchId, componentId: group.components[0].id, body: "Meter context" });
  const [single, set] = await bothLoaders(template.id);
  assert(single.status === "ready" && set.status === "ready");
  expect(single.lines).toHaveLength(2);
  for (const result of [single, set]) {
    const retired = result.lines.find(line => line.componentId === retiredComponentId)!;
    expect(retired.removedFromTemplate).toBe(true);
    expect(retired.entries).toHaveLength(1);
    expect(retired.entries[0].id).toBe(entry.id);
    expect(retired.entries[0].counts).toBe(false);
  }
  expect(single.lines[0].comment).toMatchObject({ body: "Meter context" });
  expect(set.lines[0].comment).toBeNull();
  expect(single.lines.map(line => ({ ...line, comment: null }))).toEqual(set.lines);
});
