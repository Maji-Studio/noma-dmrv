import { normalizeCarriedEntriesForHash } from "@/fn/certification/removal-entry-hash";
import * as contextBuilder from "@/fn/certification/removal-context-build";
import { generatedEvidenceFacts } from "@/fn/certification/generated-evidence-facts";
import { loadRemovalCarriedEntries } from "@/data-access/removal-carried-entries";
/**
 * Real-DB regression for the one Removal comparison. The "sent" baseline is the
 * semantic payload the REAL compile produced from the sent entries, stored as the
 * sent snapshot; each case then changes the records the way corrections do.
 * Only the registry/Source edges are mocked. buildRemovalContext, the entry
 * context and the build are real.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, certificationSubmissions, certifierProjects, creditBatches, emissionEntries, emissionEntryValues, productionProcesses, productionRuns, samples,
  removalTemplateObservations, users } from "@/db/schema";
import { makeRemoteStatement } from "./fixtures/isometric-ghg-statement";
import { createLineageFixture, cleanupLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";
import { cleanupDocumentUploads } from "./helpers/document-upload-cleanup";
import { reviewedTemplateSources } from "./helpers/template-line-sources";
import sandboxTemplate from "./fixtures/isometric/sandbox-template-2026-10-15.json";
import sandboxEnrichment from "./fixtures/isometric/sandbox-enrichment-2026-10-15.json";
import { loadTemplateEnrichment } from "@/lib/isometric/template-observations/load-enrichment";
import type { IsometricClient } from "@/lib/isometric/client";
import type { IsometricComponentBlueprint } from "@/lib/isometric";
import type { GhgEntryTemplate } from "@/lib/isometric/template-observations";
import { insertDocument } from "@/data-access/documents";
import { recordEmissionZeros } from "@/data-access/emission-zeros";
import { createEmissionEntry } from "@/data-access/emission-entries";
import { withGhgVerifierSubmissionLock } from "@/data-access/ghg-verifier-submission-lock";
import * as sources from "@/fn/certification/source-candidates";
import { emissionEntrySourceCandidates } from "@/lib/certification/emission-entry-source-bindings";
import { normalizeTemplateDefinition } from "@/lib/isometric/template-observations";
import { loadRemovalEntryCorrection } from "@/fn/certification/removal-correction-core";
import { compareRemovalCurrentContent } from "@/fn/certification/removal-content-comparison-core";
import { compileRemovalCorrectionContent } from "@/fn/certification/removal-correction-compile-core";
import { assertStatementRemovalsCurrent } from "@/fn/certification/statement-removal-correction-core";

// Same registry/Source edge the other DB-backed submission tests stub. Everything else is real.
vi.mock("@/fn/certification/source-candidates", async original => ({
  ...await original<typeof import("@/fn/certification/source-candidates")>(),
  collectCandidateSourceDocumentsForRemoval: vi.fn(),
  resolveSourceBindingCandidates: vi.fn(),
}));

// The registry says the statement came back after the Removal was sent.
vi.mock("@/lib/isometric/ghg-statements", async original => ({
  ...await original<typeof import("@/lib/isometric/ghg-statements")>(),
  getGhgStatement: vi.fn(async () => makeRemoteStatement({ status: "FAILED_VERIFICATION", submitted_at: "2099-01-01T00:00:00Z", ghg_entry_ids: ["original"] })),
}));

const NOTICE_UNAVAILABLE = "Resubmit needed: noma could not compare this Removal with what it sent.";
const userId = crypto.randomUUID();
const org = { ...makeTestOrgContext(userId), orgRole: "admin" as const };
let fixture: LineageFixture | undefined;
let observation: typeof removalTemplateObservations.$inferSelect | undefined;
let sentEntryId: string;
const documentIds: string[] = [];

afterEach(async () => {
  await cleanupDocumentUploads(org, documentIds.splice(0));
  if (fixture) {
    await db.delete(samples).where(and(eq(samples.organizationId, org.organizationId), eq(samples.creditBatchId, fixture.batchId)));
    const ids = await db.select({ id: emissionEntries.id }).from(emissionEntries).where(and(eq(emissionEntries.organizationId, org.organizationId), eq(emissionEntries.creditBatchId, fixture.batchId)));
    if (ids.length) await db.delete(emissionEntryValues).where(and(eq(emissionEntryValues.organizationId, org.organizationId), inArray(emissionEntryValues.entryId, ids.map(row => row.id))));
    await db.update(emissionEntries).set({ replacesEntryId: null }).where(and(eq(emissionEntries.organizationId, org.organizationId), eq(emissionEntries.creditBatchId, fixture.batchId)));
    await db.delete(emissionEntries).where(and(eq(emissionEntries.organizationId, org.organizationId), eq(emissionEntries.creditBatchId, fixture.batchId)));
    await db.delete(certifierProjects).where(and(eq(certifierProjects.organizationId, org.organizationId), eq(certifierProjects.facilityId, fixture.facilityId)));
    await cleanupLineageFixture(fixture);
    fixture = undefined;
  }
  if (observation) await db.delete(removalTemplateObservations).where(and(eq(removalTemplateObservations.organizationId, org.organizationId), eq(removalTemplateObservations.id, observation.id)));
  observation = undefined;
  await db.delete(activityEvents).where(and(eq(activityEvents.organizationId, org.organizationId), eq(activityEvents.actorUserId, userId)));
  await db.delete(users).where(eq(users.id, userId));
});

/** A returned Removal that sent one electricity entry with its evidence file. */
beforeEach(async () => {
  await ensureTestOrg();
  await db.insert(users).values({ id: userId, email: `${userId}@example.test`, emailVerified: true });
  const f = fixture = await createLineageFixture("ghgStatement");
  const template = structuredClone(sandboxTemplate) as GhgEntryTemplate;
  template.id = `compare-${f.removalId}`;
  // The real 1000-year storage component from the sandbox template, so the build resolves sequestration for real.
  template.groups = sandboxTemplate.groups.filter(group => group.key === "co2-stored") as unknown as typeof template.groups;
  template.groups.push({ id: "electricity", key: "pyrolysis", name: "Electricity", components: [{
    id: "line", blueprint_key: "grid_electricity_use", display_name: "line",
    inputs: [{ type: "monitored", input_key: "electricity_use", datapoint_id: null, display_name: "Electricity", quantity_kind: "energy" }],
  }] } as unknown as typeof template.groups[number]);
  const lineSources = reviewedTemplateSources(template);
  lineSources.line = { scope: "operating", entryPolicy: "additive", origin: "reviewed" };
  [observation] = await db.insert(removalTemplateObservations).values({ organizationId: org.organizationId, provider: "isometric",
    externalProjectId: "prj_test_1", externalTemplateId: template.id, definition: normalizeTemplateDefinition(template),
    semanticFingerprint: "compare", fullFingerprint: "compare", lineSources,
    enrichment: await loadTemplateEnrichment({} as IsometricClient, template, sandboxEnrichment.blueprints as IsometricComponentBlueprint[]),
  }).returning();
  await db.update(creditBatches).set({ removalTemplateId: template.id }).where(and(eq(creditBatches.organizationId, org.organizationId), eq(creditBatches.id, f.batchId)));
  await db.insert(certifierProjects).values({ organizationId: org.organizationId, provider: "isometric", facilityId: f.facilityId,
    externalProjectId: "prj_test_1", externalFacilityId: `fcl_test_${userId}`,
    defaultSoilTemperatureC: 20, defaultSoilTemperatureSource: "Test dataset" });
  // The fixture's statement submission becomes the returned statement.
  await db.update(certificationSubmissions).set({ metadata: { remoteStatus: "FAILED_VERIFICATION", submittedToVerifierAt: "2099-01-01T00:00:00Z", removalIds: ["original"] } })
    .where(and(eq(certificationSubmissions.organizationId, org.organizationId), eq(certificationSubmissions.localEntityId, f.ghgStatementId!)));

  // Source documents are the registry edge: one inventory Source plus the entries' own files.
  const inventory = { documentId: "doc-inventory", binding: { nomaRole: "inventory" as const, nomaRoleLabel: "Inventory",
    lineage: { entityType: "sample", entityId: f.sampleId, entityLabel: "Sample" },
    intendedTarget: { kind: "sequestration" as const, groupKey: "co2-stored" as const, inputKey: "product_mass" as const },
    mappingRevision: "source-binding-test-revision" } };
  vi.mocked(sources.collectCandidateSourceDocumentsForRemoval).mockImplementation(async (_ctx, args) =>
    [inventory, ...emissionEntrySourceCandidates(args.entryContributions)] as never);
  vi.mocked(sources.resolveSourceBindingCandidates).mockImplementation(async (_ctx, args) =>
    args.candidates.map(candidate => ({ ...candidate, sourceId: `src-${candidate.documentId}` })) as never);

  // The lineage must itself be submittable, so the comparison tests only the entries.
  await db.update(productionRuns).set({ dieselOperationLiters: 1, preprocessingFuelLiters: 1, dieselGensetLiters: 1, electricityKwh: 1 })
    .where(and(eq(productionRuns.organizationId, org.organizationId), eq(productionRuns.id, f.productionRunId)));
  // The 1000-year gate needs three complete Samples and a reference soil temperature.
  const chemistry = { moistureContentPercent: 5, hToCOrgRatio: 0.4, oToCOrgRatio: 0.1, inorganicCarbonPercent: 1, sReflectanceFraction: 0.5, randomReflectanceR0Percent: 3 };
  await db.update(samples).set(chemistry).where(and(eq(samples.organizationId, org.organizationId), eq(samples.id, f.sampleId)));
  await db.insert(samples).values([1, 2].map(n => ({ ...chemistry, organizationId: org.organizationId, creditBatchId: f.batchId,
    sampleCode: `S-CMP-${n}-${f.sampleId.slice(0, 6)}`, samplingTime: new Date("2026-06-13T10:00:00Z"), totalCarbonPercent: 80, organicCarbonPercent: 78 })));
  documentIds.push((await insertDocument(org, { entityType: "production_run", entityId: f.productionRunId, documentType: "sensor_data",
    fileName: "Readings.csv", fileUrl: "https://example.test/readings.csv", mimeType: "text/csv", uploadStatus: "uploaded" })).id);
  documentIds.push((await insertDocument(org, { entityType: "delivery", entityId: f.deliveryId, documentType: "delivery_receipt",
    fileName: "Receipt.pdf", fileUrl: "https://example.test/receipt.pdf", uploadStatus: "uploaded" })).id);
  const sent = await createEmissionEntry(org, { creditBatchId: f.batchId, componentId: "line", occurredOn: "2026-06-10",
    values: [{ inputKey: "electricity_use", quantityKind: "energy", magnitude: "2", unit: "kWh" }] });
  sentEntryId = sent.id;
  documentIds.push((await insertDocument(org, { entityType: "emission_entry", entityId: sent.id, documentType: "pdf", fileName: "Sent.pdf", fileUrl: "https://example.test/sent.pdf" })).id);
  await db.update(emissionEntries).set({ sentByRemovalId: f.removalId }).where(and(eq(emissionEntries.organizationId, org.organizationId), eq(emissionEntries.id, sent.id)));

  // Honest baseline: what the real compile produces for the sent entries is what was sent.
  const buildContext = vi.spyOn(contextBuilder, "buildRemovalContext");
  await compileRemovalCorrectionContent(org, f.removalId, observation);
  const baselineContext = await buildContext.mock.results.at(-1)!.value;
  buildContext.mockRestore();
  const baseline = await compileRemovalCorrectionContent(org, f.removalId, observation);
  expect(baseline).not.toHaveProperty("changedGeneratedEvidence");
  expect(baseline).toMatchObject({ entryContributions: [expect.objectContaining({ componentId: "line" })] });
  await db.insert(certificationSubmissions).values({ organizationId: org.organizationId, provider: "isometric", localEntityType: "removal",
    localEntityId: f.removalId, submissionType: "removal", status: "submitted", version: 1, submittedAt: new Date("2026-06-17"),
    externalId: "original", payloadHash: "original", payloadSnapshot: { generatedEvidenceFacts: generatedEvidenceFacts(baselineContext), semantic: baseline, templateObservationId: observation.id, frozenEntrySet: [] } });
});

const guard = () => withGhgVerifierSubmissionLock(org, fixture!.ghgStatementId!, () => assertStatementRemovalsCurrent(org, fixture!.ghgStatementId!));

it("says unchanged everywhere when nothing changed since the Removal was sent", async () => {
  const f = fixture!;
  expect(await compareRemovalCurrentContent(org, f.removalId)).toMatchObject({ kind: "unchanged", state: { comparison: "unchanged", correctionNeeded: false } });
  expect(await loadRemovalEntryCorrection(org, f.removalId)).toMatchObject({ windowOpen: true, correctionNeeded: false, comparison: "unchanged" });
  await expect(guard()).resolves.toBeUndefined();
});

it("says changed everywhere when a held replacement carries a different value, and the guard refuses", async () => {
  const f = fixture!;
  // A correction retires the sent entry (it keeps its sent owner) and holds a replacement for the same Removal.
  const [sent] = await db.select().from(emissionEntries).where(and(eq(emissionEntries.organizationId, org.organizationId), eq(emissionEntries.id, sentEntryId)));
  const [held] = await db.insert(emissionEntries).values({ ...sent, id: undefined, sentByRemovalId: null, replacesEntryId: sent.id,
    version: 1, contentRevision: 1, deletedAt: null }).returning();
  await db.insert(emissionEntryValues).values({ organizationId: org.organizationId, entryId: held.id, inputKey: "electricity_use", magnitude: "5", unit: "kWh" });
  await db.update(emissionEntries).set({ deletedAt: new Date() }).where(and(eq(emissionEntries.organizationId, org.organizationId), eq(emissionEntries.id, sent.id)));
  documentIds.push((await insertDocument(org, { entityType: "emission_entry", entityId: held.id, documentType: "pdf", fileName: "Held.pdf", fileUrl: "https://example.test/held.pdf" })).id);

  const comparison = await compareRemovalCurrentContent(org, f.removalId);
  expect(comparison).toMatchObject({ kind: "changed", state: { comparison: "changed", correctionNeeded: true, changedComponentIds: ["line"] } });
  const notice = await loadRemovalEntryCorrection(org, f.removalId);
  expect(notice).toMatchObject({ correctionNeeded: true, comparison: "changed", changedComponentIds: ["line"] });
  await expect(guard()).rejects.toThrow(/Resubmit Removal .* first/);
});

it("says unavailable everywhere when a blocker stops the compile, and the guard refuses", async () => {
  const f = fixture!;
  // A new value with no file is owned by this Removal's correction but cannot be carried.
  await createEmissionEntry(org, { creditBatchId: f.batchId, componentId: "line", occurredOn: "2026-06-11",
    values: [{ inputKey: "electricity_use", quantityKind: "energy", magnitude: "3", unit: "kWh" }] });

  const comparison = await compareRemovalCurrentContent(org, f.removalId);
  expect(comparison).toMatchObject({ kind: "unavailable", reason: "compile_refused",
    unavailableMessages: ["Add a file for each emissions entry with a value."],
    state: { comparison: "unavailable", message: NOTICE_UNAVAILABLE } });
  expect(await loadRemovalEntryCorrection(org, f.removalId)).toMatchObject({ comparison: "unavailable", message: NOTICE_UNAVAILABLE,
    unavailableMessages: ["Add a file for each emissions entry with a value."] });
  await expect(guard()).rejects.toThrow(/noma could not compare Removal .* with what it sent/);
});

it("says unchanged everywhere for a returned receiving Removal that sent an entry carried from another batch", async () => {
  const f = fixture!;
  const origin = await createLineageFixture("none");
  try {
    // The origin batch lives at the receiving facility and uses the same template, like a late entry carried forward.
    const [{ id: processId }] = await db.insert(productionProcesses).values({ organizationId: org.organizationId,
      facilityId: f.facilityId, feedstockTypeId: origin.feedstockTypeId }).returning({ id: productionProcesses.id });
    await db.update(creditBatches).set({ facilityId: f.facilityId, productionProcessId: processId, removalTemplateId: observation!.externalTemplateId })
      .where(and(eq(creditBatches.organizationId, org.organizationId), eq(creditBatches.id, origin.batchId)));
    await db.update(emissionEntries).set({ creditBatchId: origin.batchId }).where(and(eq(emissionEntries.organizationId, org.organizationId), eq(emissionEntries.id, sentEntryId)));
    // The receiving batch has no own entry, so it confirmed a zero for the line, as an operator would before sending a carried entry.
    await recordEmissionZeros(org, { removalId: f.removalId, creditBatchId: f.batchId, componentIds: ["line"] });
    // What the Removal sent is what the compile produces now that the sent entry belongs to the origin batch.
    const baseline = await compileRemovalCorrectionContent(org, f.removalId, observation!);
    expect(baseline).toMatchObject({ entryContributions: [expect.objectContaining({ componentId: "line" })] });
    expect(baseline).not.toHaveProperty("changedGeneratedEvidence");
    // The sent snapshot is frozen, so the Removal's submission is replaced by one that sent the carried entry.
    await db.delete(certificationSubmissions).where(and(eq(certificationSubmissions.organizationId, org.organizationId),
      eq(certificationSubmissions.localEntityId, f.removalId), eq(certificationSubmissions.submissionType, "removal")));
    await db.insert(certificationSubmissions).values({ organizationId: org.organizationId, provider: "isometric", localEntityType: "removal",
      localEntityId: f.removalId, submissionType: "removal", status: "submitted", version: 1, submittedAt: new Date("2026-06-17"),
      externalId: "original", payloadHash: "original", payloadSnapshot: { semantic: baseline, templateObservationId: observation!.id, frozenEntrySet: [] } });

    expect(await compareRemovalCurrentContent(org, f.removalId)).toMatchObject({ kind: "unchanged", state: { comparison: "unchanged", correctionNeeded: false } });
    expect(await loadRemovalEntryCorrection(org, f.removalId)).toMatchObject({ windowOpen: true, correctionNeeded: false, comparison: "unchanged" });
    const carried = await loadRemovalCarriedEntries(org, f.removalId);
    // The sheet read shows each frozen entry's magnitude and unit only.
    expect(normalizeCarriedEntriesForHash(carried)).toEqual(normalizeCarriedEntriesForHash(baseline!.carriedEntries as never)!
      .map(item => ({ ...item, value: { magnitude: item.value.magnitude, unit: item.value.unit } })));
    await expect(guard()).resolves.toBeUndefined();
  } finally {
    await db.update(emissionEntries).set({ creditBatchId: f.batchId }).where(and(eq(emissionEntries.organizationId, org.organizationId), eq(emissionEntries.id, sentEntryId)));
    await db.update(creditBatches).set({ facilityId: origin.facilityId, productionProcessId: origin.productionProcessId, removalTemplateId: null })
      .where(and(eq(creditBatches.organizationId, org.organizationId), eq(creditBatches.id, origin.batchId)));
    await db.delete(productionProcesses).where(and(eq(productionProcesses.organizationId, org.organizationId), eq(productionProcesses.facilityId, f.facilityId), eq(productionProcesses.feedstockTypeId, origin.feedstockTypeId)));
    await cleanupLineageFixture(origin);
  }
});

// A lineage-only change through the real context, preparation and compilation path.
it("requires resubmission everywhere after sent sample chemistry changes without entry changes", async () => {
  const f = fixture!;
  await db.update(samples).set({ sReflectanceFraction: 0.6 })
    .where(and(eq(samples.organizationId, org.organizationId), eq(samples.id, f.sampleId)));
  expect(await compareRemovalCurrentContent(org, f.removalId)).toMatchObject({ kind: "changed", state: { correctionNeeded: true } });
  expect(await loadRemovalEntryCorrection(org, f.removalId)).toMatchObject({ comparison: "changed", correctionNeeded: true });
  await expect(guard()).rejects.toThrow(/Resubmit Removal .* first/);
});
