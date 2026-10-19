import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches, creditBatchProductionRuns, productionRuns, removalTemplateObservations } from "@/db/schema";
import { observeTemplate } from "@/data-access/removal-template-observations";
import { loadBatchEmissionLines } from "@/lib/read-models/batch-emission-lines";
import type { GhgEntryTemplate } from "@/lib/isometric/template-observations";
import fixture from "./fixtures/isometric/sandbox-template-2026-10-15.json";
import { createLineageFixture, cleanupLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

// Real Postgres suite; tests/setup.ts loads .env.test and enforces the throwaway DB.
// Intentionally not run in the implementation sandbox.
const ctx = makeTestOrgContext();
const template = structuredClone(fixture) as GhgEntryTemplate;
template.id = `rvt_batch_lines_${crypto.randomUUID()}`;
const group = template.groups.find((group) => group.key === "pyrolysis")!;
group.components = group.components.filter((component) => component.blueprint_key === "grid_electricity_use");
group.components[0].inputs = group.components[0].inputs.filter((input) => input.type === "monitored");
template.groups = [group];
let lineage: LineageFixture;
let foreignBatch: LineageFixture;
let unappliedRunId: string;

beforeAll(async () => {
  await ensureTestOrg();
  lineage = await createLineageFixture("none");
  foreignBatch = await createLineageFixture("none");
  await observeTemplate(ctx, { provider: "isometric", externalProjectId: template.project_id, template,
    enrichment: { [group.components[0].id]: { electricity_use: { unit: "kWh" } } } });
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
afterAll(async () => {
  if (unappliedRunId) {
    await db.delete(creditBatchProductionRuns).where(and(eq(creditBatchProductionRuns.organizationId, TEST_ORG_ID), eq(creditBatchProductionRuns.productionRunId, unappliedRunId)));
    await db.delete(productionRuns).where(and(eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.id, unappliedRunId)));
  }
  if (lineage) await cleanupLineageFixture(lineage);
  if (foreignBatch) await cleanupLineageFixture(foreignBatch);
  await db.delete(removalTemplateObservations).where(and(eq(removalTemplateObservations.organizationId, TEST_ORG_ID), eq(removalTemplateObservations.externalTemplateId, template.id)));
});
it("loads pinned lines using all and only the batch's runs, including unapplied output", async () => {
  const lines = await loadBatchEmissionLines(ctx, lineage.facilityId, lineage.batchId);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ componentId: group.components[0].id, state: "filled", automaticFigure: { magnitude: "20", unit: "kWh" }, total: { magnitude: "20", unit: "kWh" }, entries: [], comment: null });
});
it("rejects a cross-organization batch read", async () => {
  await expect(loadBatchEmissionLines({ ...ctx, organizationId: `other-${crypto.randomUUID()}` }, lineage.facilityId, lineage.batchId)).rejects.toThrow();
});
it("refuses an unpinned batch", async () => {
  await expect(loadBatchEmissionLines(ctx, foreignBatch.facilityId, foreignBatch.batchId)).rejects.toThrow("Choose a Removal template");
});
