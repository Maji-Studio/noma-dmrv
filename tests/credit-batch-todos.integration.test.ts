import { afterEach, beforeEach, assert, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  certifierCredentials, certifierProjects, creditBatches, facilities, feedstockTypes,
  organizations, productionProcesses, removalTemplateObservations, samples, emissionEntries, emissionEntryValues,
} from "@/db/schema";
import { upsertCertifierCredentials } from "@/data-access/certifier-credentials";
import { updateRemovalDates } from "@/data-access/certifier-removals";
import { getLatestTemplateObservation, observeTemplate } from "@/data-access/removal-template-observations";
import { requireOrgContext } from "@/lib/auth/server";
import { listComponentBlueprints, listGhgEntryTemplates, listProjects, type IsometricComponentBlueprint } from "@/lib/isometric";
import { getDatapoint } from "@/lib/isometric/submissions";
import type { GhgEntryTemplate } from "@/lib/isometric/template-observations";
import { loadBatchEmissionLines } from "@/lib/read-models/batch-emission-lines";
import { loadBatchesEmissionLines } from "@/lib/read-models/batches-emission-lines";
import { creditBatchStateOf } from "@/lib/credit-batches/batch-state";
import { loadCreditBatchTodos, type CreditBatchTodos } from "@/fn/certification/credit-batch-todos-core";
import { loadCreditBatchTodosFn } from "@/fn/certification/credit-batch-todos";
import { loadCreditBatchDurabilitySummary } from "@/fn/certification/durability-batch-summary";
import { loadCreditBatchHealthSummaries, type CreditBatchHealthSummary } from "@/fn/certification/overview";
import { loadTemplateEnrichment } from "@/lib/isometric/template-observations/load-enrichment";
import type { IsometricClient } from "@/lib/isometric/client";
import * as batchSamples from "@/data-access/credit-batch-samples";
import * as batchEmissionLines from "@/lib/read-models/batches-emission-lines";
import * as facilityFacts from "@/fn/certification/facility-certifier-facts";
import templateFixture from "./fixtures/isometric/sandbox-template-2026-10-15.json";
import enrichmentFixture from "./fixtures/isometric/sandbox-enrichment-2026-10-15.json";
import { ensureTestOrg, makeTestOrgContext, TEST_SITE_POSITION } from "./helpers/test-org";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";

// Keep guards, credential resolution, enrichment, observations and all queries real.
// Only session resolution and the registry boundary below enrichment are stubbed.
vi.mock("@/lib/auth/server", async (original) => ({
  ...await original<typeof import("@/lib/auth/server")>(), requireOrgContext: vi.fn(),
}));
vi.mock("@/lib/isometric", async (original) => ({
  ...await original<typeof import("@/lib/isometric")>(),
  listProjects: vi.fn(), listGhgEntryTemplates: vi.fn(), listComponentBlueprints: vi.fn(),
}));
vi.mock("@/lib/isometric/submissions", async (original) => ({
  ...await original<typeof import("@/lib/isometric/submissions")>(), getDatapoint: vi.fn(),
}));

let ctx: ReturnType<typeof makeTestOrgContext>;
let facilityId: string;
let otherFacilityId: string;
let feedstockTypeId: string;
let productionProcessId: string;
let batch: typeof creditBatches.$inferSelect;
let template: GhgEntryTemplate;
const COMPONENT_ID = "todos-electricity";
const DOCUMENT_IDS = ["document:lab-report", "document:reflectance-histogram"];
const DATA_BLOCKERS = ["health:carbon:labSamples", "health:production:productionRuns"];
const REVIEW_BLOCKER = "health:templateLines:templateLineReview";
const READ_BLOCKER = "health:templateLines:templateLines";
const PIN_BLOCKER = "health:templateSet:templateSetup";
const MIXED_CHECKS = [...DOCUMENT_IDS, "outlier:TODO-OUTLIER", "unpaired:TODO-UNPAIRED", `emission:${COMPONENT_ID}`];

beforeEach(async () => {
  vi.clearAllMocks();
  ctx = { ...makeTestOrgContext(), organizationId: `todos-${crypto.randomUUID()}` };
  await db.insert(organizations).values({ id: ctx.organizationId, name: "To-do parity", slug: ctx.organizationId });
  vi.mocked(requireOrgContext).mockResolvedValue(ctx);
  const sites = await db.insert(facilities).values(["main", "other"].map(code => ({
    ...TEST_SITE_POSITION, organizationId: ctx.organizationId, code, name: code,
    timezone: "UTC", durabilityOption: "1000_year" as const,
  }))).returning();
  [facilityId, otherFacilityId] = sites.map(site => site.id);
  const [feedstock] = await db.insert(feedstockTypes).values({
    organizationId: ctx.organizationId, code: "TODO", name: "To-do feedstock", category: "forestry", usage: "pyrolysis",
  }).returning();
  feedstockTypeId = feedstock.id;
  const [process] = await db.insert(productionProcesses).values({
    organizationId: ctx.organizationId, facilityId, feedstockTypeId,
  }).returning();
  productionProcessId = process.id;
  template = structuredClone(templateFixture) as GhgEntryTemplate;
  template.id = `rvt_todos_${crypto.randomUUID()}`;
  const group = template.groups.find(group => group.key === "pyrolysis")!;
  group.components = group.components.filter(component => component.blueprint_key === "grid_electricity_use");
  // A new component id deliberately leaves the automatic proposal undecided.
  group.components[0].id = COMPONENT_ID;
  template.groups = [group];
  await upsertCertifierCredentials(ctx, { organizationId: ctx.organizationId, provider: "isometric",
    accessToken: "test-only-todos-token", clientSecret: "test-only-todos-secret" });
  await db.insert(certifierProjects).values({ organizationId: ctx.organizationId, facilityId,
    externalProjectId: template.project_id, externalFacilityId: `fcl_${facilityId}`, removalTemplateId: template.id });
  vi.mocked(listProjects).mockResolvedValue([]);
  vi.mocked(listGhgEntryTemplates).mockImplementation(async () => [template]);
  vi.mocked(listComponentBlueprints).mockResolvedValue(enrichmentFixture.blueprints as IsometricComponentBlueprint[]);
  vi.mocked(getDatapoint).mockImplementation(async (_client, id) => {
    const point = enrichmentFixture.datapoints[id as keyof typeof enrichmentFixture.datapoints];
    assert(point, `Missing registry fixture ${id}`);
    return point as Awaited<ReturnType<typeof getDatapoint>>;
  });
  batch = await insertBatch(template.id);
  await db.insert(samples).values([
    { sampleCode: "TODO-OUTLIER", hToCOrgRatio: 0.6, oToCOrgRatio: 0.1 },
    { sampleCode: "TODO-UNPAIRED", hToCOrgRatio: 0.3, oToCOrgRatio: null },
  ].map(sample => ({ ...sample, organizationId: ctx.organizationId, creditBatchId: batch.id,
    samplingTime: new Date("2026-06-13T10:00:00Z"), totalCarbonPercent: 80, organicCarbonPercent: 78 })));
});

afterEach(async () => {
  const org = ctx.organizationId;
  await db.delete(emissionEntryValues).where(eq(emissionEntryValues.organizationId, org));
  await db.delete(emissionEntries).where(eq(emissionEntries.organizationId, org));
  await db.delete(samples).where(eq(samples.organizationId, org));
  await db.delete(creditBatches).where(eq(creditBatches.organizationId, org));
  await db.delete(removalTemplateObservations).where(eq(removalTemplateObservations.organizationId, org));
  await db.delete(certifierProjects).where(eq(certifierProjects.organizationId, org));
  await db.delete(certifierCredentials).where(eq(certifierCredentials.organizationId, org));
  await db.delete(productionProcesses).where(eq(productionProcesses.organizationId, org));
  await db.delete(feedstockTypes).where(eq(feedstockTypes.organizationId, org));
  await db.delete(facilities).where(eq(facilities.organizationId, org));
  await db.delete(organizations).where(eq(organizations.id, org));
});

async function insertBatch(removalTemplateId: string | null) {
  const [row] = await db.insert(creditBatches).values({ organizationId: ctx.organizationId, facilityId,
    feedstockTypeId, productionProcessId, code: `CB-${crypto.randomUUID()}`, removalTemplateId,
    startDate: "2026-06-01", endDate: "2026-06-30", certifier: "isometric" }).returning();
  return row;
}

function expectItems(todos: CreditBatchTodos, blocking: string[], check: string[]) {
  expect(todos.blocking.map(item => item.id).sort()).toEqual([...blocking].sort());
  expect(todos.check.map(item => item.id).sort()).toEqual([...check].sort());
}

async function parity(
  rows: readonly { id: string; removalTemplateId: string | null }[],
  expected: { blocking: string[]; check: string[] }[],
  scope = { ctx, facilityId },
  summaries?: Record<string, CreditBatchHealthSummary>,
) {
  if (!summaries) {
    const result = await loadCreditBatchHealthSummaries(scope.facilityId, rows.map(row => row.id));
    assert(result.success, JSON.stringify(result));
    summaries = result.data;
  }
  const todos = await loadCreditBatchTodos(scope.ctx, scope.facilityId, rows);
  for (const [index, row] of rows.entries()) {
    const value = todos.get(row.id)!;
    expectItems(value, expected[index].blocking, expected[index].check);
    expect(summaries[row.id]).toMatchObject({ state: value.state, linesToDecide: value.linesToDecide,
      issueCount: value.blocking.length, checkCount: value.check.length });
    expect(summaries[row.id]).not.toHaveProperty("blocking");
    expect(summaries[row.id]).not.toHaveProperty("check");
    const action = await loadCreditBatchTodosFn(scope.facilityId, row.id);
    assert(action.success, JSON.stringify(action));
    expect(action.data).toEqual(value);
    // The durability summary (panel, key numbers, sample form) names the same samples as the Check ids.
    const durability = await loadCreditBatchDurabilitySummary(row.id);
    assert(durability.success && durability.data, JSON.stringify(durability));
    const sampleCodes = (kind: string) => value.check.map(item => item.id).filter(id => id.startsWith(`${kind}:`))
      .map(id => id.slice(kind.length + 1)).sort();
    expect([...new Set(durability.data.replicates.filter(r => r.outlier).map(r => r.sampleCode))].sort())
      .toEqual(sampleCodes("outlier"));
    expect([...new Set(durability.data.eligibility.unpairedHToCSampleCodes)].sort()).toEqual(sampleCodes("unpaired"));
    const single = await loadBatchEmissionLines(scope.ctx, scope.facilityId, row.id);
    const bulk = (await loadBatchesEmissionLines(scope.ctx, rows)).get(row.id)!;
    expect(single.status).toBe(bulk.status);
    if (single.status === "ready" && bulk.status === "ready") {
      expect(single.lines.map(line => ({ ...line, comment: null }))).toEqual(bulk.lines);
    } else {
      expect(single).toEqual(bulk);
    }
  }
  return { todos, summaries };
}

it("counts explicit Blocking and mixed document, sample and emission Check items", async () => {
  const { todos } = await parity([batch], [{ blocking: [REVIEW_BLOCKER, ...DATA_BLOCKERS], check: MIXED_CHECKS }]);
  expect(todos.get(batch.id)?.linesToDecide).toBe(1);
  expect(await getLatestTemplateObservation(ctx, "isometric", template.id)).not.toBeNull();
});

it.each(["batch", "facility"] as const)("resolves the batch's to-dos with an uppercase %s id", async (uppercaseId) => {
  const expected = await loadCreditBatchTodosFn(facilityId, batch.id);
  assert(expected.success, JSON.stringify(expected));
  expectItems(expected.data, [REVIEW_BLOCKER, ...DATA_BLOCKERS], MIXED_CHECKS);
  const result = await loadCreditBatchTodosFn(
    uppercaseId === "facility" ? facilityId.toUpperCase() : facilityId,
    uppercaseId === "batch" ? batch.id.toUpperCase() : batch.id,
  );
  expect(result).toEqual(expected);
});

it("counts the review line for a stored entry on a retired template component", async () => {
  const retiredComponentId = `${COMPONENT_ID}-retired`;
  const previousTemplate = structuredClone(template);
  previousTemplate.groups[0].components[0].id = retiredComponentId;
  const previous = await observeTemplate(ctx, {
    provider: "isometric", externalProjectId: template.project_id, template: previousTemplate,
    enrichment: await loadTemplateEnrichment({} as IsometricClient, previousTemplate,
      enrichmentFixture.blueprints as IsometricComponentBlueprint[]),
  });
  const [entry] = await db.insert(emissionEntries).values({
    organizationId: ctx.organizationId, creditBatchId: batch.id, removalTemplateId: template.id,
    componentId: retiredComponentId, observationId: previous.id,
    inputShape: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }],
    lineRule: "additive", kind: "value", occurredOn: "2026-06-13",
  }).returning();
  await db.insert(emissionEntryValues).values({ organizationId: ctx.organizationId,
    entryId: entry.id, inputKey: "electricity_use", magnitude: "2", unit: "kWh" });
  const { todos, summaries } = await parity([batch], [{
    // The retired component's non-counting entry also triggers the existing emissions health blocker.
    blocking: [REVIEW_BLOCKER, ...DATA_BLOCKERS, "health:emissions:emissions"], check: [...MIXED_CHECKS, `emission:${retiredComponentId}`],
  }]);
  const display = await loadBatchEmissionLines(ctx, facilityId, batch.id);
  assert(display.status === "ready");
  // No current contract means needsReview; buildCreditBatchOpenItems counts that state.
  expect(display.lines.find(line => line.componentId === retiredComponentId)).toMatchObject({
    removedFromTemplate: true, state: "needsReview", entries: [{ id: entry.id, counts: false }],
  });
  expect(todos.get(batch.id)?.blocking).toHaveLength(4);
  expect(todos.get(batch.id)?.check).toHaveLength(6);
  expect(summaries[batch.id]).toMatchObject({ issueCount: 4, checkCount: 6 });
});

it("counts an unpinned batch without emission Check items", async () => {
  await db.update(creditBatches).set({ removalTemplateId: null }).where(eq(creditBatches.id, batch.id));
  await parity([{ ...batch, removalTemplateId: null }], [{ blocking: [PIN_BLOCKER, ...DATA_BLOCKERS], check: MIXED_CHECKS.slice(0, -1) }]);
});

it("keeps no observation separate from an incomplete observation", async () => {
  // An unreadable registry blueprint response fails inside real enrichment,
  // before observeTemplate writes. A datapoint rejection alone is caught and
  // would instead persist an incomplete observation (the next test).
  const unreadable = structuredClone(enrichmentFixture.blueprints) as IsometricComponentBlueprint[];
  const electricity = unreadable.find(blueprint => blueprint.key === "grid_electricity_use")!;
  Object.defineProperty(electricity, "inputs", { get() { throw new Error("Unreadable registry blueprint inputs"); } });
  vi.mocked(listComponentBlueprints).mockResolvedValue(unreadable);
  // Without an observation, the live template's empty line sources still require review.
  await parity([batch], [{ blocking: [READ_BLOCKER, REVIEW_BLOCKER, ...DATA_BLOCKERS], check: MIXED_CHECKS.slice(0, -1) }]);
  expect(await getLatestTemplateObservation(ctx, "isometric", template.id)).toBeNull();
});

it("persists unknown fixed inputs and keeps their emission Check item", async () => {
  vi.mocked(getDatapoint).mockRejectedValue(new Error("Registry datapoint unavailable"));
  await parity([batch], [{ blocking: [READ_BLOCKER, REVIEW_BLOCKER, ...DATA_BLOCKERS], check: MIXED_CHECKS }]);
  const observation = await getLatestTemplateObservation(ctx, "isometric", template.id);
  expect(observation?.enrichment[COMPONENT_ID].grid_carbon_intensity).toEqual({ status: "unknown" });
});

it("loads facility facts once through the real list action for pinned and unpinned siblings", async () => {
  const sibling = await insertBatch(null);
  const spy = vi.spyOn(facilityFacts, "loadFacilityCertifierFacts");
  const linesSpy = vi.spyOn(batchEmissionLines, "loadBatchesEmissionLines");
  const samplesSpy = vi.spyOn(batchSamples, "getCreditBatchesWithSamples");
  const result = await loadCreditBatchHealthSummaries(facilityId, [batch.id, sibling.id]);
  assert(result.success, JSON.stringify(result));
  expect(spy).toHaveBeenCalledExactlyOnceWith(ctx, facilityId);
  expect(linesSpy).toHaveBeenCalledExactlyOnceWith(ctx, [
    expect.objectContaining({ id: batch.id, removalTemplateId: batch.removalTemplateId }),
    expect.objectContaining({ id: sibling.id, removalTemplateId: sibling.removalTemplateId }),
  ], { comments: false });
  // Per-batch durability reads in buildRemovalContext -> loadDurabilityBatchData are pre-existing.
  const setReads = samplesSpy.mock.calls.filter(([, ids]) => [batch.id, sibling.id].every(id => ids.includes(id)));
  expect(setReads).toEqual([[ctx, [batch.id, sibling.id]]]);
  await parity([batch, sibling], [
    { blocking: [REVIEW_BLOCKER, ...DATA_BLOCKERS], check: MIXED_CHECKS },
    { blocking: [PIN_BLOCKER, ...DATA_BLOCKERS], check: DOCUMENT_IDS },
  ], undefined, result.data);
});

it("keeps member and admin counts identical but removes destinations for decisions", async () => {
  const expected = [{ blocking: [REVIEW_BLOCKER, ...DATA_BLOCKERS], check: MIXED_CHECKS }];
  const admin = await parity([batch], expected);
  const member = { ...ctx, orgRole: "member" as const };
  vi.mocked(requireOrgContext).mockResolvedValue(member);
  const read = await parity([batch], expected, { ctx: member, facilityId });
  const adminTodos = admin.todos.get(batch.id)!;
  const memberTodos = read.todos.get(batch.id)!;
  for (const id of [REVIEW_BLOCKER, `emission:${COMPONENT_ID}`]) {
    expect([...adminTodos.blocking, ...adminTodos.check].find(item => item.id === id)?.target).not.toBeNull();
    expect([...memberTodos.blocking, ...memberTodos.check].find(item => item.id === id)?.target).toBeNull();
  }
});

it("refuses another organization, another facility, missing batches and invalid ids through both actions", async () => {
  const spy = vi.spyOn(facilityFacts, "loadFacilityCertifierFacts");
  expect(await loadCreditBatchTodosFn(facilityId, crypto.randomUUID())).toEqual({
    success: false, error: "Credit batch was not found.",
  });
  expect(await loadCreditBatchTodosFn(otherFacilityId, batch.id)).toEqual({
    success: false, error: "Batch does not belong to requested facility",
  });
  for (const [site, id] of [[otherFacilityId, batch.id], [facilityId, crypto.randomUUID()], ["invalid", batch.id], [facilityId, "invalid"]]) {
    expect(await loadCreditBatchTodosFn(site, id)).toMatchObject({ success: false });
    expect(await loadCreditBatchHealthSummaries(site, [id])).toMatchObject({ success: false });
  }
  vi.mocked(requireOrgContext).mockResolvedValue({ ...ctx, organizationId: `foreign-${crypto.randomUUID()}` });
  expect(await loadCreditBatchTodosFn(facilityId, batch.id)).toMatchObject({ success: false });
  expect(await loadCreditBatchHealthSummaries(facilityId, [batch.id])).toMatchObject({ success: false });
  expect(spy).not.toHaveBeenCalled();
});

it("keeps the 50-batch bound and the empty-list short circuit", async () => {
  const spy = vi.spyOn(facilityFacts, "loadFacilityCertifierFacts");
  expect(await loadCreditBatchHealthSummaries(facilityId, Array.from({ length: 51 }, () => batch.id)))
    .toMatchObject({ success: false });
  expect(await loadCreditBatchHealthSummaries(facilityId, [])).toEqual({ success: true, data: {} });
  expect(spy).not.toHaveBeenCalled();
});

// These complete lineage fixtures exercise the real Removal link and submission
// reads as well as to-dos. They are deliberately unpinned, independent of the
// registry configuration above, and retain their incomplete sample evidence.
it.each(["none", "removal"] as const)("keeps raw counts for a batch in a %s Removal", async (submission) => {
  await ensureTestOrg();
  await withLineageFixture(async (lineage) => {
    const lineageCtx = makeTestOrgContext();
    vi.mocked(requireOrgContext).mockResolvedValue(lineageCtx);
    if (submission === "removal") {
      // A submitted ledger row without its reporting window is an interrupted submission.
      await updateRemovalDates(lineageCtx, lineage.removalId, {
        startedOn: "2026-06-01", completedOn: "2026-06-30",
      });
    }
    const { summaries } = await parity([{ id: lineage.batchId, removalTemplateId: null }], [{
      blocking: [PIN_BLOCKER, "health:carbon:carbon+lab-samples", "health:entityReadiness:production-runs",
        "health:entityReadiness:submission-deliveryEvidence"],
      check: DOCUMENT_IDS,
    }], { ctx: lineageCtx, facilityId: lineage.facilityId });
    const summary = summaries[lineage.batchId];
    expect(summary.removalId).toBe(lineage.removalId);
    expect(summary.checkCount).toBe(2);
    if (submission === "removal") {
      expect(summary.removalStatus).toMatchObject({ kind: "submitted" });
      expect(creditBatchStateOf(summary)).toMatchObject({ state: "submitted", blockingCount: 0, openTodoCount: 0 });
    } else {
      expect(summary.removalStatus).toMatchObject({ kind: "not-submitted" });
      expect(creditBatchStateOf(summary).openTodoCount).toBe(summary.issueCount + summary.checkCount);
    }
  }, submission);
});
