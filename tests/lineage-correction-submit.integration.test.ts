import { makeContext, makeTemplate, fakeExternalIds, makeInventorySourceDocument } from "./fixtures/submit-removal-orchestrator";
// The harness registers its module mocks on import, so it must load before any module that pulls in the mocked ones.
import type { TransportLeg } from "@/db/schema";
import { generatedEvidenceFacts } from "@/fn/certification/generated-evidence-facts";
import { compareRemovalCurrentContent } from "@/fn/certification/removal-content-comparison-core";
import { ensureTransportEvidenceLedgerSourceFromContext } from "@/fn/certification/evidence-ledger";
import * as evidenceStorage from "@/fn/certification/evidence-ledger-core";
import * as evidenceLedgers from "@/fn/certification/ensure-evidence-ledgers";
import { logger } from "@/lib/log";
import * as comparisonContext from "@/fn/certification/removal-context-build";
vi.mock("@/fn/certification/removal-context-build");
import { submitGhgStatementToVerifierCore } from "@/fn/certification/submit-ghg-statement";
import { makeRemoteStatement } from "./fixtures/isometric-ghg-statement";
import { loadRemovalEntryCorrection } from "@/fn/certification/removal-correction-core";
import { assertStatementRemovalsCurrent } from "@/fn/certification/statement-removal-correction-core";
import { withGhgVerifierSubmissionLock } from "@/data-access/ghg-verifier-submission-lock";
import { getRecordLock } from "@/data-access/certification-lineage-guards";
import { createProductionRun, updateProductionRun } from "@/data-access/production-runs";
import { buildRemovalSubmissionBuild } from "@/fn/certification/removal-submission-build";
import { requirePreparedRemovalSubmission } from "@/fn/certification/removal-submission-prepare";
import * as scopeReader from "@/fn/certification/removal-scope";
/** DB-backed claim/freshness/reservation regression. Registry I/O uses the orchestrator harness. */
import { afterEach, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { productionRuns, certificationSubmissions, certifierGhgStatements, certifierProjects, certifierRemovals, creditBatches,
  emissionEntries, emissionEntryValues, creditBatchProductionRuns, facilities, feedstocks, outputStockMoistureReadings, productionRunFeedstockDraws, productionRunFeedstocks, reactors, removalTemplateObservations, users, activityEvents } from "@/db/schema";
import { createLineageFixture, cleanupLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";
import { feedstockFixtureValues } from "./helpers/feedstock-fixture";
import { cleanupDocumentUploads } from "./helpers/document-upload-cleanup";



import * as claims from "@/data-access/certification-submissions";
import * as ledger from "@/data-access/certification";
import * as reservations from "@/data-access/production-claim-reservations";
import * as context from "@/fn/certification/certify-context-core";
import * as sources from "@/fn/certification/source-candidates";
import * as isometric from "@/lib/isometric";
import { loadBatchEmissionContext } from "@/fn/certification/batch-emission-context";
import { loadRemovalEntryContext } from "@/fn/certification/removal-entry-context";

import { normalizeTemplateDefinition } from "@/lib/isometric/template-observations";
import { reviewedTemplateSources } from "./helpers/template-line-sources";
import { submitRemoval } from "@/fn/certification/submit-removal";
import type { RemovalScope } from "@/fn/certification/removal-scope";

// Registry ids are globally unique in certification_submissions; keep them distinct per file.
const FILE_TAG = crypto.randomUUID().slice(0, 8);

vi.mock("@/lib/isometric/ghg-statements", async original => ({
  ...await original<typeof import("@/lib/isometric/ghg-statements")>(),
  getGhgStatement: vi.fn(async () => makeRemoteStatement({ status: "FAILED_VERIFICATION", submitted_at: "2099-01-01T00:00:00Z", ghg_entry_ids: [originalId] })),
  resubmitGhgStatement: vi.fn(), submitGhgStatement: vi.fn(),
}));
const userId = crypto.randomUUID();
const originalId = `original-${userId}`;
const statementExternalId = `returned-statement-${userId}`;
const org = { ...makeTestOrgContext(userId), orgRole: "admin" as const };
let fixture: LineageFixture | undefined;
let observationId: string | undefined;
const documentIds: string[] = [];
afterEach(async () => {
  await cleanupDocumentUploads(org, documentIds.splice(0));
  await cleanupExtra();
  if (fixture) {
    const ids = await db.select({ id: emissionEntries.id }).from(emissionEntries).where(and(eq(emissionEntries.organizationId, org.organizationId), eq(emissionEntries.creditBatchId, fixture.batchId)));
    if (ids.length) await db.delete(emissionEntryValues).where(and(eq(emissionEntryValues.organizationId, org.organizationId), inArray(emissionEntryValues.entryId, ids.map(row => row.id))));
    await db.delete(emissionEntries).where(and(eq(emissionEntries.organizationId, org.organizationId), eq(emissionEntries.creditBatchId, fixture.batchId)));
    await db.delete(certifierProjects).where(and(eq(certifierProjects.organizationId, org.organizationId), eq(certifierProjects.facilityId, fixture.facilityId)));
    await cleanupLineageFixture(fixture);
  }
  if (observationId) await db.delete(removalTemplateObservations).where(and(eq(removalTemplateObservations.organizationId, org.organizationId), eq(removalTemplateObservations.id, observationId)));
  await db.delete(activityEvents).where(and(eq(activityEvents.organizationId, org.organizationId), eq(activityEvents.actorUserId, userId)));
  await db.delete(users).where(eq(users.id, userId));
});

const extra = { runIds: [] as string[], reactorIds: [] as string[], feedstockIds: [] as string[] };
async function cleanupExtra() {
  const runIds = extra.runIds.splice(0);
  if (runIds.length) {
    await db.delete(creditBatchProductionRuns).where(inArray(creditBatchProductionRuns.productionRunId, runIds));
    await db.delete(productionRunFeedstocks).where(inArray(productionRunFeedstocks.productionRunId, runIds));
    await db.delete(productionRunFeedstockDraws).where(inArray(productionRunFeedstockDraws.productionRunId, runIds));
    await db.delete(outputStockMoistureReadings).where(inArray(outputStockMoistureReadings.productionRunId, runIds));
    await db.delete(productionRuns).where(inArray(productionRuns.id, runIds));
  }
  const reactorIds = extra.reactorIds.splice(0);
  if (reactorIds.length) await db.delete(reactors).where(inArray(reactors.id, reactorIds));
  const feedstockIds = extra.feedstockIds.splice(0);
  if (feedstockIds.length) await db.delete(feedstocks).where(inArray(feedstocks.id, feedstockIds));
}
/** Records and completes a run through the real write path that attaches it to a covering batch. */
async function completeRunOn(f: LineageFixture, day: string, tag: string) {
  // The fixture's own run still occupies its reactor and drained its bin, so each late run gets its own of both.
  const [feedstock] = await db.insert(feedstocks).values(await feedstockFixtureValues(db, { organizationId: org.organizationId, code: `FS-LATE-${tag}-${userId.slice(0, 6)}`,
    storageLocationId: f.feedstockBinId, status: "complete", facilityId: f.facilityId, feedstockTypeId: f.feedstockTypeId, massDryKg: 90, massWetKg: 100, moistureContentPercent: 10 })).returning({ id: feedstocks.id });
  extra.feedstockIds.push(feedstock.id);
  const [reactor] = await db.insert(reactors).values({ organizationId: org.organizationId, code: `RX-LATE-${tag}-${userId.slice(0, 6)}`,
    identifier: `Late ${tag}`, facilityId: f.facilityId, reactorType: "batch" }).returning({ id: reactors.id });
  extra.reactorIds.push(reactor.id);
  const run = await createProductionRun(org, { code: `PR-LATE-${tag}-${userId.slice(0, 6)}`, facilityId: f.facilityId, reactorId: reactor.id, status: "running",
    startTime: new Date(`${day}T08:00:00Z`), endTime: null, feedstockMoisturePercent: 20, feedstockDraws: [{ storageLocationId: f.feedstockBinId, wetMassKg: 10 }] });
  extra.runIds.push(run.id);
  await updateProductionRun(org, run.id, { expectedVersion: run.version, status: "complete", endTime: new Date(`${day}T12:00:00Z`),
    biocharStorageLocationId: f.biocharBinId, biocharOutputKg: 3, biocharMoisturePercent: 20 });
  return run.id;
}
async function batchRunIds(batchId: string) {
  return (await db.select({ id: creditBatchProductionRuns.productionRunId }).from(creditBatchProductionRuns)
    .where(and(eq(creditBatchProductionRuns.organizationId, org.organizationId), eq(creditBatchProductionRuns.creditBatchId, batchId)))).map(row => row.id);
}

it.each(["run", "distance"] as const)("detects a %s-only correction, fences the statement, supersedes and relocks on resubmit", async correctionKind => {
  let distanceKm = 5;
  let generatedDocumentId = "";
  // Restore transaction lock exports hidden by the general orchestrator harness.
  Object.assign(await import("@/data-access/facility-durability-lock"),
    await vi.importActual("@/data-access/facility-durability-lock"));
  Object.assign(await import("@/data-access/facility-certification-boundary-lock"),
    await vi.importActual("@/data-access/facility-certification-boundary-lock"));
  Object.assign(await import("@/lib/certification/submission-lock"),
    await vi.importActual("@/lib/certification/submission-lock"));
  const removals = await import("@/data-access/certifier-removals");
  const realRemovals = await vi.importActual<typeof removals>("@/data-access/certifier-removals");
  vi.mocked(removals.getCreditBatchesByRemovalId).mockImplementation(realRemovals.getCreditBatchesByRemovalId);
  await ensureTestOrg();
  await db.insert(users).values({ id: userId, email: `${userId}@example.test`, emailVerified: true });
  const f = fixture = await createLineageFixture("none");
  const template = makeTemplate();
  template.id = `correction-${f.removalId}`;
  template.groups.push({ id: "electricity", key: "pyrolysis", name: "Electricity", components: ["line"].map(id => ({
    id, blueprint_key: "grid_electricity_use", display_name: id,
    inputs: [{ type: "monitored", input_key: "electricity_use", datapoint_id: null, display_name: "Electricity", quantity_kind: "energy" }],
  })) } as unknown as typeof template.groups[number]);
  const lineSources = reviewedTemplateSources(template);
  lineSources.line = { scope: "operating", entryPolicy: "none", automaticSource: "run-electricity", origin: "reviewed" };
  const [observation] = await db.insert(removalTemplateObservations).values({ organizationId: org.organizationId, provider: "isometric",
    externalProjectId: "prj_test_1", externalTemplateId: template.id, definition: normalizeTemplateDefinition(template),
    semanticFingerprint: "correction-submit", fullFingerprint: "correction-submit", lineSources,
    enrichment: { "rtc-product-mass": { product_mass: { unit: "kg" } }, line: { electricity_use: { unit: "kWh" } }, zero: { electricity_use: { unit: "kWh" } } },
  }).returning();
  observationId = observation.id;
  await db.update(facilities).set({ durabilityOption: "200_year" }).where(and(eq(facilities.organizationId, org.organizationId), eq(facilities.id, f.facilityId)));
  await db.update(creditBatches).set({ removalTemplateId: template.id }).where(and(eq(creditBatches.organizationId, org.organizationId), eq(creditBatches.id, f.batchId)));
  await db.insert(certifierProjects).values({ organizationId: org.organizationId, provider: "isometric", facilityId: f.facilityId, externalProjectId: "prj_test_1", externalFacilityId: `fcl_test_${userId}` });
  const [statement] = await db.insert(certifierGhgStatements).values({ organizationId: org.organizationId, facilityId: f.facilityId, reportingPeriodEndOn: "2026-06-30" }).returning();
  f.ghgStatementId = statement.id;
  await db.update(certifierRemovals).set({ ghgStatementId: statement.id }).where(and(eq(certifierRemovals.organizationId, org.organizationId), eq(certifierRemovals.id, f.removalId)));
  await db.insert(certificationSubmissions).values({ organizationId: org.organizationId, provider: "isometric", localEntityType: "ghgStatement", localEntityId: statement.id,
    submissionType: "ghg_statement", status: "submitted", version: 1, externalId: statementExternalId, submittedAt: new Date("2026-01-02"), metadata: { remoteStatus: "FAILED_VERIFICATION", submittedToVerifierAt: "2099-01-01T00:00:00Z", removalIds: [originalId] } });
  await db.update(productionRuns).set({ electricityKwh: 10 }).where(and(eq(productionRuns.organizationId, org.organizationId), eq(productionRuns.id, f.productionRunId)));
  const realClaims = await vi.importActual<typeof claims>("@/data-access/certification-submissions");
  vi.mocked(claims.claimSubmissionDraft).mockImplementation(realClaims.claimSubmissionDraft);
  vi.mocked(claims.getLatestSubmission).mockImplementation(realClaims.getLatestSubmission);
  vi.mocked(claims.getLatestSubmissionWithExecutor).mockImplementation(realClaims.getLatestSubmissionWithExecutor);
  vi.mocked(claims.recordConfirmedSubmissionIdentity).mockImplementation(realClaims.recordConfirmedSubmissionIdentity);
  const realReservations = await vi.importActual<typeof reservations>("@/data-access/production-claim-reservations");
  vi.mocked(reservations.reserveProductionEmissionsClaims).mockImplementation(realReservations.reserveProductionEmissionsClaims);
  const transitions = await import("@/data-access/submission-ledger-transitions");
  vi.mocked(ledger.markSubmissionSubmitted).mockImplementation(transitions.markSubmissionSubmitted);
  const scope = { removalId: f.removalId, facilityId: f.facilityId, memberBatches: [{ id: f.batchId, code: "CB-CORRECTION", removalTemplateId: template.id, startDate: "2026-06-01" }],
    lineages: [{ application: { applicationDate: new Date("2026-06-16") } }] } as RemovalScope;
  const facilityFacts = { templatesById: { [template.id]: { observation } } };
  const inventorySource = makeInventorySourceDocument("doc-test-1");
  const batchesWithSamples = makeContext().batchesWithSamples.map(batch => ({
    ...batch,
    creditBatchId: f.batchId,
  }));
  // This harness supplies production claims with no Application intents.
  // Resolve the inventory Source through the same Sample/batch membership used
  // by the real evidence planner instead.
  inventorySource.binding.lineage = {
    entityType: "sample",
    entityId: batchesWithSamples[0].samples[0].id,
    entityLabel: batchesWithSamples[0].samples[0].sampleCode,
  };
  vi.mocked(context.resolveScopeForRemoval).mockResolvedValue({ memberBatches: [{
    id: f.batchId, code: "CB-CORRECTION", productionRunIds: [makeContext().runs[0].id],
    applicationIds: [], productionEmissionsClaimedByRemovalId: null,
  }] } as unknown as RemovalScope);
  const loadContext = async (options?: { claimedSubmissionId?: string }, advisory = true) => {
    const facts = await loadBatchEmissionContext(org, f.facilityId, scope.memberBatches, facilityFacts,
      { claimedAttempt: advisory ? undefined : { removalId: f.removalId, submissionId: options?.claimedSubmissionId } });
    const entries = await loadRemovalEntryContext(org, scope, facts, facilityFacts);
    const result = makeContext(undefined, { facilityId: f.facilityId, removalId: f.removalId, removalTemplate: template, lineSources,
      latestSubmission: null, memberBatchClaims: [], batchesWithSamples, removalEntryContext: entries });
    result.memberBatches[0] = { ...result.memberBatches[0], id: f.batchId, removalTemplateId: template.id };
    result.mapping = { ...result.mapping!, facilityId: f.facilityId };
    result.blueprintsForTemplate.push({ key: "grid_electricity_use", display_name: "Electricity", inputs: [{ input_key: "electricity_use", quantity_kind: "energy", compatible_unit: "kWh", data_shape: "SCALAR" }] } as never);
    const [run] = await db.select().from(productionRuns).where(and(eq(productionRuns.organizationId, org.organizationId), eq(productionRuns.id, f.productionRunId)));
    result.runs[0].electricityKwh = run.electricityKwh;
    if (correctionKind === "distance") result.transportLegs.feedstock = [{ id: "leg", entityId: "feedstock", entityType: "feedstock",
      distanceKm, loadMassKg: 1000, transportMethodType: "road", calculationMethodType: "distance_based",
      originName: "Origin", destinationName: "Facility", distanceSource: "manual", createdAt: new Date("2026-01-01"),
    } as TransportLeg];
    result.memberBatchClaims = [{ creditBatchId: f.batchId, code: "CB-CORRECTION", durabilityOption: "200_year", claimedByRemovalId: null,
      productionRunIds: [result.runs[0].id], applicationIds: [], applicationSlices: [] }];
    result.correctionWindowOpen = true;
    return result;
  };
  vi.mocked(context.loadRemovalSubmissionContext).mockImplementation(async (_org, _id, options) => loadContext(options, false));
  // The harness supplies complete, valid submission facts; the changed electricity
  // field is read from the real run on every build, including claim freshness.
  vi.mocked(comparisonContext.buildRemovalContext).mockImplementation(async () => loadContext());
  vi.spyOn(scopeReader, "resolveScopeForRemoval").mockResolvedValue(scope);
  vi.mocked(ledger.getCertifierProjectByFacility).mockResolvedValue(makeContext().mapping);
  const facilitiesDA = await import("@/data-access/facilities");
  vi.mocked(facilitiesDA.getFacilityById).mockResolvedValue({ timezone: "UTC" } as never);
  vi.mocked(sources.collectCandidateSourceDocumentsForRemoval).mockImplementation(async () =>
    [{ ...inventorySource, documentId: generatedDocumentId || inventorySource.documentId }]);
  if (correctionKind === "distance") {
    // Real model generation and hashing; only artifact storage/Source mirroring is faked.
    // Its content-addressed document is attached to the harness's inventory input.
    vi.spyOn(evidenceStorage, "ensureLedgerSource").mockImplementation(async (_ctx, spec) => {
      generatedDocumentId = `ledger-${spec.contentHash}`;
      return { status: "created", documentId: generatedDocumentId, externalSourceId: `src-${generatedDocumentId}`, contentHash: spec.contentHash };
    });
    vi.mocked(evidenceLedgers.ensureEvidenceLedgersFromContext).mockImplementation(async (ctx, removalId, submissionContext) => {
      await ensureTransportEvidenceLedgerSourceFromContext(ctx, removalId, submissionContext);
    });
  }
  // Build uses the contributions supplied by its context, including the claim-scoped freshness read.
  vi.mocked(sources.resolveSourceBindingCandidates).mockImplementation(async (_ctx, args) => args.candidates.map(candidate => ({ ...candidate, sourceId: `src-${candidate.documentId}` })));
  vi.mocked(isometric.createDatapoint).mockImplementation(vi.fn(fakeExternalIds("dp")) as never);
  vi.mocked(isometric.createGhgEntry).mockImplementation(vi.fn(fakeExternalIds(`rmv-${FILE_TAG}`)) as never);
  const baselineContext = await loadContext();
  if (correctionKind === "distance") await evidenceLedgers.ensureEvidenceLedgersFromContext(org, f.removalId, baselineContext, logger);
  const baseline = await buildRemovalSubmissionBuild({ orgCtx: org, removalId: f.removalId,
    ctx: baselineContext, prepared: requirePreparedRemovalSubmission(baselineContext) });
  // Snapshots are frozen once a row leaves draft, so insert the sent attempt with its snapshot.
  const [prior] = await db.insert(certificationSubmissions).values({ organizationId: org.organizationId, provider: "isometric", localEntityType: "removal",
    localEntityId: f.removalId, submissionType: "removal", status: "submitted", version: 1, submittedAt: new Date("2026-01-01"), externalId: originalId, payloadHash: isometric.payloadHash(baseline.semanticPayload),
    payloadSnapshot: { generatedEvidenceFacts: baseline.generatedEvidenceFacts, semantic: baseline.semanticPayload, templateObservationId: observation.id, frozenEntrySet: [] } }).returning();
  expect(await loadRemovalEntryCorrection(org, f.removalId)).toMatchObject({ windowOpen: true, correctionNeeded: false });

  if (correctionKind === "distance") {
    distanceKm = 10;
    const changed = await compareRemovalCurrentContent(org, f.removalId);
    expect(changed).toMatchObject({ kind: "changed", state: { correctionNeeded: true } });
    expect(generatedEvidenceFacts(await loadContext())).not.toEqual(baseline.generatedEvidenceFacts);
    // Before regeneration, only the comparison facts differ. The claim would reuse
    // the old submission if generation did not replace the Source.
    const beforeGeneration = await buildRemovalSubmissionBuild({ orgCtx: org, removalId: f.removalId,
      ctx: await loadContext(), prepared: requirePreparedRemovalSubmission(await loadContext()) });
    expect(isometric.payloadHash(beforeGeneration.semanticPayload)).toBe(isometric.payloadHash(baseline.semanticPayload));
  } else {
    // Exercise the real mutation guard and update path, not a direct fixture SQL edit.
    const [beforeRun] = await db.select().from(productionRuns).where(and(eq(productionRuns.organizationId, org.organizationId), eq(productionRuns.id, f.productionRunId)));
    const updated = await updateProductionRun(org, f.productionRunId, { expectedVersion: beforeRun.version, electricityKwh: 11 });
    expect(updated.electricityKwh).toBe(11);
    const correction = await loadRemovalEntryCorrection(org, f.removalId);
    expect(correction).toMatchObject({ correctionNeeded: true, changedComponentIds: ["line"],
      message: "Resubmit needed: 1 component changed since this Removal was sent." });
  }
  await expect(withGhgVerifierSubmissionLock(org, statement.id,
    () => assertStatementRemovalsCurrent(org, statement.id))).rejects.toThrow("Resubmit Removal");

  // While the Removal is returned, a run completed inside the batch window joins the batch automatically.
  const lateRunId = await completeRunOn(f, "2026-06-20", "RETURNED");
  expect(await batchRunIds(f.batchId)).toContain(lateRunId);
  expect(await loadRemovalEntryCorrection(org, f.removalId)).toMatchObject({ correctionNeeded: true });

  const statementArgs = { orgCtx: org, ghgStatementId: statement.id, input: {
    externalReportUrl: "https://example.test/report.pdf", summaryOfChanges: "Corrected electricity consumption.", confirmProduction: true,
  } };
  await expect(submitGhgStatementToVerifierCore(statementArgs)).rejects.toThrow("Resubmit Removal");
  expect(isometric.resubmitGhgStatement).not.toHaveBeenCalled();

  // The submission harness stubs scope expansion; this test concerns the real
  // ledger claim and reservation plus the production value recompile.
  await expect(submitRemoval({ orgCtx: org, removalId: f.removalId })).resolves.toMatchObject({ version: 2 });
  const [old] = await db.select().from(certificationSubmissions).where(and(eq(certificationSubmissions.organizationId, org.organizationId), eq(certificationSubmissions.id, prior.id)));
  expect(old.status).toBe("superseded");
  expect(isometric.createGhgEntry).toHaveBeenCalledOnce();
  const sent = await realClaims.getLatestSubmission(org, { provider: "isometric", localEntityType: "removal", submissionType: "removal", localEntityId: f.removalId });
  expect(sent?.payloadSnapshot).toMatchObject({ semantic: { inputs: expect.arrayContaining([
    expect.objectContaining({ rtcId: "line", value: correctionKind === "run" ? 11 : 10 }),
  ]) } });
  expect(sent?.payloadHash).not.toBe(prior.payloadHash);
  expect(sent?.payloadSnapshot).toMatchObject({ generatedEvidenceFacts: generatedEvidenceFacts(await loadContext()) });
  expect(await compareRemovalCurrentContent(org, f.removalId)).toMatchObject({ kind: "unchanged", state: { correctionNeeded: false } });
  expect((await db.transaction(tx => getRecordLock(org, tx, { entityType: "productionRun", entityId: f.productionRunId }))).level).toBe("sent");
  expect(await loadRemovalEntryCorrection(org, f.removalId)).toMatchObject({ correctionNeeded: false, windowOpen: false });
  // Contrast: once the Removal is Sent again, a run completed in the window stays without a batch.
  const sentRunId = await completeRunOn(f, "2026-06-22", "SENT");
  expect(await batchRunIds(f.batchId)).not.toContain(sentRunId);
  await expect(withGhgVerifierSubmissionLock(org, statement.id,
    () => assertStatementRemovalsCurrent(org, statement.id))).resolves.toBeUndefined();
  // Report storage and registry transport remain harness boundaries. Statement
  // membership, the correction guard, locks and metadata finalization are real.
  const realLedger = await vi.importActual<typeof ledger>("@/data-access/certification");
  vi.mocked(ledger.updateSubmissionMetadata).mockImplementation(realLedger.updateSubmissionMetadata);
  vi.mocked(ledger.attachReportDocument).mockResolvedValue({ id: crypto.randomUUID() } as never);
  vi.mocked(isometric.resubmitGhgStatement).mockResolvedValue(makeRemoteStatement({
    id: statementExternalId, status: "AWAITING_VERIFICATION", ghg_entry_ids: [sent!.externalId!],
  }));
  await expect(submitGhgStatementToVerifierCore(statementArgs)).resolves.toMatchObject({ remoteStatus: "AWAITING_VERIFICATION" });
  expect(isometric.resubmitGhgStatement).toHaveBeenCalledOnce();
});
