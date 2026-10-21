/** DB-backed claim/freshness/reservation regression. Registry I/O uses the orchestrator harness. */
import { makeContext, makeTemplate, fakeExternalIds, makeInventorySourceDocument } from "./fixtures/submit-removal-orchestrator";
import { afterEach, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { certificationSubmissions, certifierGhgStatements, certifierProjects, certifierRemovals, creditBatches,
  emissionEntries, emissionEntryValues, facilities, removalTemplateObservations, users, activityEvents } from "@/db/schema";
import { createLineageFixture, cleanupLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";
import { cleanupDocumentUploads } from "./helpers/document-upload-cleanup";
import { insertDocument } from "@/data-access/documents";
import { createEmissionEntry, getEmissionEntry } from "@/data-access/emission-entries";
import { recordEmissionZeros } from "@/data-access/emission-zeros";
import * as claims from "@/data-access/certification-submissions";
import * as ledger from "@/data-access/certification";
import * as reservations from "@/data-access/production-claim-reservations";
import * as context from "@/fn/certification/certify-context-core";
import * as sources from "@/fn/certification/source-candidates";
import * as isometric from "@/lib/isometric";
import { loadBatchEmissionContext } from "@/fn/certification/batch-emission-context";
import { loadRemovalEntryContext } from "@/fn/certification/removal-entry-context";
import { emissionEntrySourceCandidates } from "@/lib/certification/emission-entry-source-bindings";
import { normalizeTemplateDefinition } from "@/lib/isometric/template-observations";
import { reviewedTemplateSources } from "./helpers/template-line-sources";
import { submitRemoval } from "@/fn/certification/submit-removal";
import type { RemovalScope } from "@/fn/certification/removal-scope";

vi.mock("@/lib/isometric/ghg-statements", () => ({ getGhgStatement: async () => ({ status: "FAILED_VERIFICATION", submitted_at: "2099-01-01T00:00:00Z", ghg_entry_ids: ["original"] }) }));
const userId = crypto.randomUUID();
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

it.each([false, true])("submits a returned Removal through claim and freshness, interrupted before reservation: %s", async (interrupt) => {
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
  template.groups.push({ id: "electricity", key: "pyrolysis", name: "Electricity", components: ["line", "zero"].map(id => ({
    id, blueprint_key: "grid_electricity_use", display_name: id,
    inputs: [{ type: "monitored", input_key: "electricity_use", datapoint_id: null, display_name: "Electricity", quantity_kind: "energy" }],
  })) } as unknown as typeof template.groups[number]);
  const lineSources = reviewedTemplateSources(template);
  for (const id of ["line", "zero"]) lineSources[id] = { scope: "operating", entryPolicy: "additive", origin: "reviewed" };
  const [observation] = await db.insert(removalTemplateObservations).values({ organizationId: org.organizationId, provider: "isometric",
    externalProjectId: "prj_test_1", externalTemplateId: template.id, definition: normalizeTemplateDefinition(template),
    semanticFingerprint: "correction-submit", fullFingerprint: "correction-submit", lineSources,
    enrichment: { "rtc-product-mass": { product_mass: { unit: "kg" } }, line: { electricity_use: { unit: "kWh" } }, zero: { electricity_use: { unit: "kWh" } } },
  }).returning();
  observationId = observation.id;
  await db.update(facilities).set({ durabilityOption: "200_year" }).where(and(eq(facilities.organizationId, org.organizationId), eq(facilities.id, f.facilityId)));
  await db.update(creditBatches).set({ removalTemplateId: template.id }).where(and(eq(creditBatches.organizationId, org.organizationId), eq(creditBatches.id, f.batchId)));
  await db.insert(certifierProjects).values({ organizationId: org.organizationId, provider: "isometric", facilityId: f.facilityId, externalProjectId: "prj_test_1", externalFacilityId: "fcl_test_1" });
  const [prior] = await db.insert(certificationSubmissions).values({ organizationId: org.organizationId, provider: "isometric", localEntityType: "removal",
    localEntityId: f.removalId, submissionType: "removal", status: "submitted", version: 1, submittedAt: new Date("2026-01-01"), externalId: "original", payloadHash: "original" }).returning();
  const [statement] = await db.insert(certifierGhgStatements).values({ organizationId: org.organizationId, facilityId: f.facilityId, reportingPeriodEndOn: "2026-06-30" }).returning();
  f.ghgStatementId = statement.id;
  await db.update(certifierRemovals).set({ ghgStatementId: statement.id }).where(and(eq(certifierRemovals.organizationId, org.organizationId), eq(certifierRemovals.id, f.removalId)));
  await db.insert(certificationSubmissions).values({ organizationId: org.organizationId, provider: "isometric", localEntityType: "ghgStatement", localEntityId: statement.id,
    submissionType: "ghg_statement", status: "submitted", version: 1, externalId: "returned-statement", submittedAt: new Date("2026-01-02"), metadata: { remoteStatus: "FAILED_VERIFICATION", removalIds: ["original"] } });
  const added = await createEmissionEntry(org, { creditBatchId: f.batchId, componentId: "line", occurredOn: "2026-06-10", values: [{ inputKey: "electricity_use", quantityKind: "energy", magnitude: "2", unit: "kWh" }] });
  const evidence = await insertDocument(org, { entityType: "emission_entry", entityId: added.id, documentType: "pdf", fileName: "Evidence.pdf", fileUrl: "https://example.test/evidence.pdf" });
  documentIds.push(evidence.id);
  const zeros = await recordEmissionZeros(org, { removalId: f.removalId, creditBatchId: f.batchId, componentIds: ["zero"] });
  const realClaims = await vi.importActual<typeof claims>("@/data-access/certification-submissions");
  vi.mocked(claims.claimSubmissionDraft).mockImplementation(realClaims.claimSubmissionDraft);
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
  // This fixture omits production claims, so Application membership is empty.
  // Resolve the inventory Source through the same Sample/batch membership used
  // by the real evidence planner instead.
  inventorySource.binding.lineage = {
    entityType: "sample",
    entityId: batchesWithSamples[0].samples[0].id,
    entityLabel: batchesWithSamples[0].samples[0].sampleCode,
  };
  vi.mocked(context.resolveScopeForRemoval).mockResolvedValue({ memberBatches: [] } as unknown as RemovalScope);
  vi.mocked(context.loadRemovalSubmissionContext).mockImplementation(async (_org, _id, options) => {
    const facts = await loadBatchEmissionContext(org, f.facilityId, scope.memberBatches, facilityFacts,
      { removalId: f.removalId, submissionId: options?.claimedSubmissionId });
    const entries = await loadRemovalEntryContext(org, scope, facts, facilityFacts);
    const result = makeContext(undefined, { facilityId: f.facilityId, removalId: f.removalId, removalTemplate: template, lineSources,
      latestSubmission: null, memberBatchClaims: [], batchesWithSamples, removalEntryContext: entries });
    result.memberBatches[0] = { ...result.memberBatches[0], id: f.batchId, removalTemplateId: template.id };
    result.mapping = { ...result.mapping!, facilityId: f.facilityId };
    result.blueprintsForTemplate.push({ key: "grid_electricity_use", display_name: "Electricity", inputs: [{ input_key: "electricity_use", quantity_kind: "energy", compatible_unit: "kWh", data_shape: "SCALAR" }] } as never);
    return result;
  });
  vi.mocked(sources.collectCandidateSourceDocumentsForRemoval).mockImplementation(async (_ctx, args) =>
    [inventorySource, ...emissionEntrySourceCandidates(args.entryContributions)]);
  // Build uses the contributions supplied by its context, including the claim-scoped freshness read.
  vi.mocked(sources.resolveSourceBindingCandidates).mockImplementation(async (_ctx, args) => args.candidates.map(candidate => ({ ...candidate, sourceId: `src-${candidate.documentId}` })));
  vi.mocked(isometric.createDatapoint).mockImplementation(vi.fn(fakeExternalIds("dp")) as never);
  vi.mocked(isometric.createGhgEntry).mockImplementation(vi.fn(fakeExternalIds("rmv")) as never);
  if (interrupt) {
    // Model process loss: the committed draft survives without failure cleanup.
    vi.mocked(reservations.rejectSubmissionAndReleaseProductionClaims).mockResolvedValueOnce(undefined);
    vi.mocked(reservations.reserveProductionEmissionsClaims).mockRejectedValueOnce(new Error("Interrupted before reservation"));
    await expect(submitRemoval({ orgCtx: org, removalId: f.removalId })).rejects.toThrow("Interrupted before reservation");
    const latest = await realClaims.getLatestSubmission(org, { provider: "isometric", localEntityType: "removal", submissionType: "removal", localEntityId: f.removalId });
    expect(latest).toMatchObject({ status: "draft", version: 2 });
    expect(await getEmissionEntry(org, added.id)).toMatchObject({ sentByRemovalId: null, sendReservedBySubmissionId: null });
    expect(isometric.createGhgEntry).not.toHaveBeenCalled();
    await db.update(certificationSubmissions).set({ lockedAt: new Date(0) }).where(and(
      eq(certificationSubmissions.organizationId, org.organizationId), eq(certificationSubmissions.id, latest!.id)));
  }
  await expect(submitRemoval({ orgCtx: org, removalId: f.removalId })).resolves.toMatchObject({ version: 2 });
  for (const id of [added.id, ...zeros.entryIds]) expect(await getEmissionEntry(org, id)).toMatchObject({ sentByRemovalId: f.removalId, sendReservedBySubmissionId: null });
  const [old] = await db.select().from(certificationSubmissions).where(and(eq(certificationSubmissions.organizationId, org.organizationId), eq(certificationSubmissions.id, prior.id)));
  expect(old.status).toBe("superseded");
  expect(isometric.createGhgEntry).toHaveBeenCalledOnce();
});
