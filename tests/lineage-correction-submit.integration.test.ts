import { makeContext, makeTemplate, fakeExternalIds, makeInventorySourceDocument } from "./fixtures/submit-removal-orchestrator";
import { submitGhgStatementToVerifierCore } from "@/fn/certification/submit-ghg-statement";
import { makeRemoteStatement } from "./fixtures/isometric-ghg-statement";
import { loadRemovalEntryCorrection } from "@/fn/certification/removal-correction-core";
import { assertStatementRemovalsCurrent } from "@/fn/certification/statement-removal-correction-core";
import { withGhgVerifierSubmissionLock } from "@/data-access/ghg-verifier-submission-lock";
import { getRecordLock } from "@/data-access/certification-lineage-guards";
import { updateProductionRun } from "@/data-access/production-runs";
import { buildRemovalSubmissionBuild } from "@/fn/certification/removal-submission-build";
import { requirePreparedRemovalSubmission } from "@/fn/certification/removal-submission-prepare";
import * as scopeReader from "@/fn/certification/removal-scope";
/** DB-backed claim/freshness/reservation regression. Registry I/O uses the orchestrator harness. */
import { afterEach, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { productionRuns, certificationSubmissions, certifierGhgStatements, certifierProjects, certifierRemovals, creditBatches,
  emissionEntries, emissionEntryValues, facilities, removalTemplateObservations, users, activityEvents } from "@/db/schema";
import { createLineageFixture, cleanupLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";
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

it("detects a run-only correction, fences the statement, supersedes and relocks on resubmit", async () => {
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
      advisory ? undefined : { removalId: f.removalId, submissionId: options?.claimedSubmissionId }, false);
    const entries = await loadRemovalEntryContext(org, scope, facts, facilityFacts);
    const result = makeContext(undefined, { facilityId: f.facilityId, removalId: f.removalId, removalTemplate: template, lineSources,
      latestSubmission: null, memberBatchClaims: [], batchesWithSamples, removalEntryContext: entries });
    result.memberBatches[0] = { ...result.memberBatches[0], id: f.batchId, removalTemplateId: template.id };
    result.mapping = { ...result.mapping!, facilityId: f.facilityId };
    result.blueprintsForTemplate.push({ key: "grid_electricity_use", display_name: "Electricity", inputs: [{ input_key: "electricity_use", quantity_kind: "energy", compatible_unit: "kWh", data_shape: "SCALAR" }] } as never);
    const [run] = await db.select().from(productionRuns).where(and(eq(productionRuns.organizationId, org.organizationId), eq(productionRuns.id, f.productionRunId)));
    result.runs[0].electricityKwh = run.electricityKwh;
    result.memberBatchClaims = [{ creditBatchId: f.batchId, code: "CB-CORRECTION", durabilityOption: "200_year", claimedByRemovalId: null,
      productionRunIds: [result.runs[0].id], applicationIds: [], applicationSlices: [] }];
    result.correctionWindowOpen = true;
    return result;
  };
  vi.mocked(context.loadRemovalSubmissionContext).mockImplementation(async (_org, _id, options) => loadContext(options, false));
  // The harness supplies complete, valid submission facts; the changed electricity
  // field is read from the real run on every build, including claim freshness.
  vi.mocked(context.buildRemovalContext).mockImplementation(async () => loadContext());
  vi.spyOn(scopeReader, "resolveScopeForRemoval").mockResolvedValue(scope);
  vi.mocked(ledger.getCertifierProjectByFacility).mockResolvedValue(makeContext().mapping);
  const facilitiesDA = await import("@/data-access/facilities");
  vi.mocked(facilitiesDA.getFacilityById).mockResolvedValue({ timezone: "UTC" } as never);
  vi.mocked(sources.collectCandidateSourceDocumentsForRemoval).mockImplementation(async () => [inventorySource]);
  // Build uses the contributions supplied by its context, including the claim-scoped freshness read.
  vi.mocked(sources.resolveSourceBindingCandidates).mockImplementation(async (_ctx, args) => args.candidates.map(candidate => ({ ...candidate, sourceId: `src-${candidate.documentId}` })));
  vi.mocked(isometric.createDatapoint).mockImplementation(vi.fn(fakeExternalIds("dp")) as never);
  vi.mocked(isometric.createGhgEntry).mockImplementation(vi.fn(fakeExternalIds("rmv")) as never);
  const baselineContext = await loadContext();
  const baseline = await buildRemovalSubmissionBuild({ orgCtx: org, removalId: f.removalId,
    ctx: baselineContext, prepared: requirePreparedRemovalSubmission(baselineContext) });
  // Snapshots are frozen once a row leaves draft, so insert the sent attempt with its snapshot.
  const [prior] = await db.insert(certificationSubmissions).values({ organizationId: org.organizationId, provider: "isometric", localEntityType: "removal",
    localEntityId: f.removalId, submissionType: "removal", status: "submitted", version: 1, submittedAt: new Date("2026-01-01"), externalId: originalId, payloadHash: "original",
    payloadSnapshot: { semantic: baseline.semanticPayload, templateObservationId: observation.id, frozenEntrySet: [] } }).returning();
  expect(await loadRemovalEntryCorrection(org, f.removalId)).toMatchObject({ windowOpen: true, correctionNeeded: false });

  // Exercise the real mutation guard and update path, not a direct fixture SQL edit.
  const [beforeRun] = await db.select().from(productionRuns).where(and(eq(productionRuns.organizationId, org.organizationId), eq(productionRuns.id, f.productionRunId)));
  const updated = await updateProductionRun(org, f.productionRunId, { expectedVersion: beforeRun.version, electricityKwh: 11 });
  expect(updated.electricityKwh).toBe(11);
  const correction = await loadRemovalEntryCorrection(org, f.removalId);
  expect(correction).toMatchObject({ correctionNeeded: true, changedComponentIds: ["line"],
    message: "Resubmit needed: 1 component changed since this Removal was sent." });
  await expect(withGhgVerifierSubmissionLock(org, statement.id,
    () => assertStatementRemovalsCurrent(org, statement.id))).rejects.toThrow("Resubmit Removal");

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
    expect.objectContaining({ rtcId: "line", value: 11 }),
  ]) } });
  expect((await db.transaction(tx => getRecordLock(org, tx, { entityType: "productionRun", entityId: f.productionRunId }))).level).toBe("sent");
  expect(await loadRemovalEntryCorrection(org, f.removalId)).toMatchObject({ correctionNeeded: false, windowOpen: false });
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
