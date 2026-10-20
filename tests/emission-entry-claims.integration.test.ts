import { requestDocumentUploadInTransaction, confirmDocumentUploadInTransaction, uploadFactsFor } from "@/data-access/document-writes";
import { cleanupDocumentUploads } from "./helpers/document-upload-cleanup";
import { documents } from "@/db/schema";
import { insertDocument, listDocumentsForEntity, listEmissionEntryDocumentsByIds } from "@/data-access/documents";
import { collectCandidateSourceDocumentsForRemoval } from "@/fn/certification/source-candidates";
import { planRemovalEvidence } from "@/fn/certification/removal-evidence-plan";
import { frozenEntriesForAttempt } from "@/fn/certification/removal-entry-context";
import { discardLocalRemovalDraft } from "@/data-access/certifier-removals";
import { deleteCreditBatchApplicationSlices } from "@/data-access/credit-batch-delete-slices";
/** Real PostgreSQL coverage. Deliberately not run by the offline implementation verification. */
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, certificationSubmissions, creditBatchApplications, creditBatches, emissionEntries, emissionEntryValues,
  removalTemplateObservations, users, certifierRemovals, organizations, facilities } from "@/db/schema";
import { createEmissionEntry, deleteEmissionEntry, getEmissionEntry, updateEmissionEntry } from "@/data-access/emission-entries";
import { assertEmissionEntryDocumentWritable } from "@/data-access/emission-entry-lock";
import { recordEmissionZeros } from "@/data-access/emission-zeros";
import { reserveProductionEmissionsClaims, rejectSubmissionAndReleaseProductionClaims } from "@/data-access/production-claim-reservations";
import { markSubmissionSubmitted, retireStaleSubmissionDraft } from "@/data-access/submission-ledger-transitions";
import { claimRemovalDeletion, finalizeRemovalDeletion } from "@/data-access/certifier-removal-deletion";
import { loadBatchEmissionEntryFacts } from "@/data-access/emission-entry-facts";
import { deriveRemovalEntryContributions } from "@/lib/certification/removal-emission-contributions";
import { readRemovalEntrySnapshot } from "@/lib/certification/removal-entry-snapshot";
import { cleanupLineageFixture, createLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID, TEST_SITE_POSITION } from "./helpers/test-org";

vi.mock("@/lib/certification/emissions-entry-gate", () => ({ emissionsEntriesEnabled: () => true, requireEmissionsEntriesEnabled: () => {} }));
const userId = `entry-claims-${crypto.randomUUID()}`;
const ctx = { ...makeTestOrgContext(userId), orgRole: "owner" as const };
let fixture: LineageFixture;
let second: LineageFixture | undefined;
let observation: typeof removalTemplateObservations.$inferSelect;
const NEWER_DOCUMENT_COUNT = 201;
const shape = [{ key: "electricity_use", type: "monitored" as const, quantityKind: "energy" as const }];
beforeAll(async () => { await ensureTestOrg(); });
beforeEach(async () => {
  await db.insert(users).values({ id: userId, email: `${userId}@example.test`, emailVerified: true }).onConflictDoNothing();
  fixture = await createLineageFixture("none");
  [observation] = await db.insert(removalTemplateObservations).values({
    organizationId: TEST_ORG_ID, provider: "isometric", externalProjectId: "project", externalTemplateId: `claims-${crypto.randomUUID()}`,
    semanticFingerprint: "claims", fullFingerprint: "claims", definition: { groups: [{ id: "g", key: "pyrolysis", displayName: "Group", description: "",
      components: ["line", "zero"].map(id => ({ id, displayName: id, description: null, blueprintKey: "grid_electricity_use", inputs: shape })),
    }] }, enrichment: { line: { electricity_use: { unit: "kWh" } }, zero: { electricity_use: { unit: "kWh" } } },
    lineSources: { line: { scope: "operating", entryPolicy: "additive", origin: "reviewed" }, zero: { scope: "operating", entryPolicy: "additive", origin: "reviewed" } },
  }).returning();
  await db.update(creditBatches).set({ removalTemplateId: observation.externalTemplateId }).where(eq(creditBatches.id, fixture.batchId));
});
afterEach(async () => {
  const entries = await db.select({ id: emissionEntries.id }).from(emissionEntries).where(eq(emissionEntries.creditBatchId, fixture.batchId));
  if (entries.length) {
    await db.delete(emissionEntryValues).where(inArray(emissionEntryValues.entryId, entries.map(row => row.id)));
    await db.delete(emissionEntries).where(inArray(emissionEntries.id, entries.map(row => row.id)));
  }
  await db.update(creditBatches).set({ productionEmissionsClaimedByRemovalId: null, productionEmissionsClaimReservedBySubmissionId: null }).where(eq(creditBatches.id, fixture.batchId));
  if (second) {
    await db.update(creditBatchApplications).set({ creditBatchId: second.batchId }).where(eq(creditBatchApplications.removalId, second.removalId));
    await cleanupLineageFixture(second);
    second = undefined;
  }
  await cleanupLineageFixture(fixture);
  await db.delete(removalTemplateObservations).where(eq(removalTemplateObservations.id, observation.id));
  await db.delete(activityEvents).where(eq(activityEvents.actorUserId, userId));
  await db.delete(users).where(eq(users.id, userId));
});
async function value() {
  return createEmissionEntry(ctx, { creditBatchId: fixture.batchId, componentId: "line", occurredOn: "2026-06-10",
    values: [{ inputKey: "electricity_use", quantityKind: "energy", magnitude: "2", unit: "kWh" }] });
}
async function draft(frozenEntrySet: { entryId: string; contentRevision: number }[], removalId = fixture.removalId, version = 1) {
  const [row] = await db.insert(certificationSubmissions).values({ organizationId: ctx.organizationId, provider: "isometric", submissionType: "removal",
    localEntityType: "removal", localEntityId: removalId, version, status: "draft", lockedAt: new Date(),
    payloadHash: crypto.randomUUID(), payloadSnapshot: { frozenEntrySet, templateObservationId: observation.id },
  }).returning();
  return row;
}
function reserve(row: Awaited<ReturnType<typeof draft>>, production = true) {
  return reserveProductionEmissionsClaims(ctx, { removalId: row.localEntityId, submissionId: row.id,
    creditBatchIds: production ? [fixture.batchId] : [], entryClaim: { memberBatchIds: [fixture.batchId], frozenEntrySet: readRemovalEntrySnapshot(row).frozenEntrySet } });
}
it("atomically races entry and production reservations for overlapping Removals", async () => {
  second = await createLineageFixture("none");
  await db.update(creditBatchApplications).set({ creditBatchId: fixture.batchId }).where(eq(creditBatchApplications.removalId, second.removalId));
  const entry = await value();
  const frozen = [{ entryId: entry.id, contentRevision: entry.contentRevision }];
  const a = await draft(frozen);
  const b = await draft(frozen, second.removalId);
  const outcomes = await Promise.allSettled([reserve(a), reserve(b)]);
  expect(outcomes.filter(row => row.status === "fulfilled")).toHaveLength(1);
  const [batch] = await db.select().from(creditBatches).where(eq(creditBatches.id, fixture.batchId));
  expect((await getEmissionEntry(ctx, entry.id)).sendReservedBySubmissionId).toBe(batch.productionEmissionsClaimReservedBySubmissionId);
});
it("rolls back production reservation on a frozen revision mismatch", async () => {
  const entry = await value();
  const row = await draft([{ entryId: entry.id, contentRevision: entry.contentRevision }]);
  await updateEmissionEntry(ctx, { id: entry.id, expectedVersion: entry.version, occurredOn: "2026-06-11" });
  await expect(reserve(row)).rejects.toThrow("Emissions entries changed");
  const [batch] = await db.select().from(creditBatches).where(eq(creditBatches.id, fixture.batchId));
  expect(batch.productionEmissionsClaimReservedBySubmissionId).toBeNull();
});
it.each([false, true])("release preserves zero ownership and keeps ambiguous reservations (%s)", async (ambiguous) => {
  const zeros = await recordEmissionZeros(ctx, { removalId: fixture.removalId, creditBatchId: fixture.batchId, componentIds: ["zero"] });
  const zero = await getEmissionEntry(ctx, zeros.entryIds[0]);
  const row = await draft([{ entryId: zero.id, contentRevision: zero.contentRevision }]);
  await reserve(row);
  if (ambiguous) await db.update(certificationSubmissions).set({ metadata: { externalMutation: "possible" } }).where(eq(certificationSubmissions.id, row.id));
  await rejectSubmissionAndReleaseProductionClaims(ctx, { submissionId: row.id, expectedLockedAt: row.lockedAt!, errorMessage: "fixture failure" });
  const saved = await getEmissionEntry(ctx, zero.id);
  expect(saved.sendReservedBySubmissionId).toBe(ambiguous ? row.id : null);
  expect(saved.confirmedForRemovalId).toBe(fixture.removalId);
  expect(saved.deletedAt).toBeNull();
});
it("refuses edits and evidence changes while reserved, while a new entry joins only the next contribution", async () => {
  const entry = await value();
  const row = await draft([{ entryId: entry.id, contentRevision: entry.contentRevision }]);
  await reserve(row);
  const locked = await getEmissionEntry(ctx, entry.id);
  await expect(updateEmissionEntry(ctx, { id: entry.id, expectedVersion: locked.version, note: "changed" })).rejects.toThrow("reserved or sent");
  await expect(assertEmissionEntryDocumentWritable(ctx, entry.id)).rejects.toThrow("reserved or sent");
  const next = await value();
  await reserve(row); // Exact frozen retry must not capture next.
  expect((await getEmissionEntry(ctx, next.id)).sendReservedBySubmissionId).toBeNull();
  await markSubmissionSubmitted(ctx, row.id, { externalId: "ghg-fixture", expectedLockedAt: row.lockedAt!,
    productionEmissionsClaim: { removalId: fixture.removalId, creditBatchIds: [fixture.batchId] } });
  expect((await getEmissionEntry(ctx, entry.id)).sentByRemovalId).toBe(fixture.removalId);
  expect((await getEmissionEntry(ctx, next.id)).sentByRemovalId).toBeNull();
});
it("rolls the submitted stamp back when an expected entry reservation is missing", async () => {
  const entry = await value();
  const row = await draft([{ entryId: entry.id, contentRevision: entry.contentRevision }]);
  await reserve(row);
  await db.update(emissionEntries).set({ sendReservedBySubmissionId: null }).where(eq(emissionEntries.id, entry.id));
  await expect(markSubmissionSubmitted(ctx, row.id, { externalId: "ghg-fixture", expectedLockedAt: row.lockedAt!,
    productionEmissionsClaim: { removalId: fixture.removalId, creditBatchIds: [fixture.batchId] } })).rejects.toThrow("reservation changed");
  const [saved] = await db.select().from(certificationSubmissions).where(eq(certificationSubmissions.id, row.id));
  expect(saved.status).toBe("draft");
});
it("never includes a tombstoned entry in the manifest or frozen set", async () => {
  const entry = await value();
  await deleteEmissionEntry(ctx, entry.id, entry.version);
  const { entries } = await loadBatchEmissionEntryFacts(ctx, fixture.batchId, observation);
  const result = deriveRemovalEntryContributions({ removalId: fixture.removalId, memberBatchIds: [fixture.batchId], window: { start: "2026-06-01", end: "2026-06-16" },
    contenders: [], entries, lineSources: observation.lineSources, monitoredInputs: [{ componentId: "line", inputKey: "electricity_use", unit: "kWh" }] });
  expect(result.manifest).toEqual([]);
  expect(result.entrySet).toEqual([]);
});
it("finalizes draft deletion with zero activity and no dangling owner FK", async () => {
  const zero = await recordEmissionZeros(ctx, { removalId: fixture.removalId, creditBatchId: fixture.batchId, componentIds: ["zero"] });
  const entry = await value();
  const zeroRow = await getEmissionEntry(ctx, zero.entryIds[0]);
  const attempt = await draft([{ entryId: entry.id, contentRevision: entry.contentRevision }, { entryId: zeroRow.id, contentRevision: zeroRow.contentRevision }]);
  await reserve(attempt);
  await db.update(certificationSubmissions).set({ lockedAt: new Date(0) }).where(eq(certificationSubmissions.id, attempt.id));
  const claim = await claimRemovalDeletion(ctx, fixture.facilityId, fixture.removalId);
  await finalizeRemovalDeletion(ctx, claim, { deletedGhgEntryIds: [], deletedBiocharApplicationIds: [], absentGhgEntryIds: [], absentBiocharApplicationIds: [], unresolvedBiocharApplicationReferences: [],
    productionBatches: (claim.productionBatches ?? []).map((batch) => ({ creditBatchId: batch.creditBatchId, externalId: batch.externalProductionBatchId, outcome: "absent" as const })) });
  expect(await db.select().from(emissionEntries).where(eq(emissionEntries.id, zero.entryIds[0]))).toEqual([]);
  expect(await db.select().from(certifierRemovals).where(eq(certifierRemovals.id, fixture.removalId))).toEqual([]);
  expect((await getEmissionEntry(ctx, entry.id)).sendReservedBySubmissionId).toBeNull();
  expect(await db.select().from(activityEvents).where(and(eq(activityEvents.entityId, zero.entryIds[0]), eq(activityEvents.action, "deleted")))).toHaveLength(1);
});
it("enforces composite organization FKs for claims and zero ownership", async () => {
  const entry = await value();
  const orgId = `foreign-claims-${crypto.randomUUID()}`;
  await db.insert(organizations).values({ id: orgId, name: "Foreign claims fixture", slug: orgId });
  const [facility] = await db.insert(facilities).values({ ...TEST_SITE_POSITION, organizationId: orgId, code: "FK-CLAIMS", name: "Foreign claims", timezone: "UTC" }).returning();
  const [removal] = await db.insert(certifierRemovals).values({ organizationId: orgId, facilityId: facility.id, code: "RM-FK-CLAIMS" }).returning();
  const [submission] = await db.insert(certificationSubmissions).values({ organizationId: orgId, provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: removal.id }).returning();
  try {
    for (const patch of [{ sentByRemovalId: removal.id }, { confirmedForRemovalId: removal.id, kind: "zero" as const }, { sendReservedBySubmissionId: submission.id }]) {
      await expect(db.update(emissionEntries).set(patch).where(eq(emissionEntries.id, entry.id))).rejects.toThrow();
    }
  } finally {
    await db.delete(certificationSubmissions).where(eq(certificationSubmissions.id, submission.id));
    await db.delete(certifierRemovals).where(eq(certifierRemovals.id, removal.id));
    await db.delete(facilities).where(eq(facilities.id, facility.id));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  }
});
it("records activity when a new value tombstones an unsubmitted draft's zero", async () => {
  const zeros = await recordEmissionZeros(ctx, { removalId: fixture.removalId, creditBatchId: fixture.batchId, componentIds: ["line"] });
  await value();
  const [zero] = await db.select().from(emissionEntries).where(eq(emissionEntries.id, zeros.entryIds[0]));
  expect(zero.deletedAt).not.toBeNull();
  expect(zero.confirmedForRemovalId).toBe(fixture.removalId);
  expect(await db.select().from(activityEvents).where(and(eq(activityEvents.entityId, zero.id), eq(activityEvents.action, "deleted")))).toHaveLength(1);
});

it("releases a retired attempt so its entry can be edited", async () => {
  const entry = await value();
  const row = await draft([{ entryId: entry.id, contentRevision: entry.contentRevision }]);
  await reserve(row);
  await retireStaleSubmissionDraft(ctx, row.id, { reason: "fixture drift" });
  const released = await getEmissionEntry(ctx, entry.id);
  expect(released.sendReservedBySubmissionId).toBeNull();
  await updateEmissionEntry(ctx, { id: entry.id, expectedVersion: released.version, note: "editable again" });
  expect((await getEmissionEntry(ctx, entry.id)).note).toBe("editable again");
  const [batch] = await db.select().from(creditBatches).where(eq(creditBatches.id, fixture.batchId));
  expect(batch.productionEmissionsClaimReservedBySubmissionId).toBeNull();
});
it.each(["discard", "orphan GC"])("deletes ledger-less zeros through %s with activity history", async (path) => {
  const zero = await recordEmissionZeros(ctx, { removalId: fixture.removalId, creditBatchId: fixture.batchId, componentIds: ["zero"] });
  if (path === "discard") await discardLocalRemovalDraft(ctx, fixture.facilityId, fixture.removalId);
  else await db.transaction(async (tx) => {
    await tx.select().from(creditBatches).where(eq(creditBatches.id, fixture.batchId)).for("update");
    await deleteCreditBatchApplicationSlices(ctx, tx, fixture.batchId);
  });
  expect(await db.select().from(emissionEntries).where(eq(emissionEntries.id, zero.entryIds[0]))).toEqual([]);
  expect(await db.select().from(certifierRemovals).where(eq(certifierRemovals.id, fixture.removalId))).toEqual([]);
  expect(await db.select().from(activityEvents).where(and(eq(activityEvents.entityId, zero.entryIds[0]), eq(activityEvents.action, "deleted")))).toHaveLength(1);
});

it("retries an empty frozen set after production reservation and a new entry", async () => {
  const row = await draft([]);
  await reserve(row);
  await value();
  const [batch] = await db.select().from(creditBatches).where(eq(creditBatches.id, fixture.batchId));
  const entryFacts = await loadBatchEmissionEntryFacts(ctx, fixture.batchId, observation);
  const frozen = frozenEntriesForAttempt(row, { [fixture.batchId]: { ...entryFacts, automaticFigures: {},
    productionReservationSubmissionId: batch.productionEmissionsClaimReservedBySubmissionId } });
  expect(frozen).toEqual([]);
  await reserve(row);
  await markSubmissionSubmitted(ctx, row.id, { externalId: "empty-fixture", expectedLockedAt: row.lockedAt!,
    productionEmissionsClaim: { removalId: fixture.removalId, creditBatchIds: [fixture.batchId] } });
  const entries = await db.select().from(emissionEntries).where(eq(emissionEntries.creditBatchId, fixture.batchId));
  expect(entries).toHaveLength(1);
  expect(entries[0].sentByRemovalId).toBeNull();
});

it("plans the exact file of an entry on the submitted contribution path", async () => {
  const entry = await value();
  const document = await insertDocument(ctx, { entityType: "emission_entry", entityId: entry.id,
    documentType: "pdf", fileName: "Entry evidence.pdf", fileUrl: "https://example.test/evidence.pdf" });
  try {
    const { entries } = await loadBatchEmissionEntryFacts(ctx, fixture.batchId, observation);
    const contributions = deriveRemovalEntryContributions({ removalId: fixture.removalId,
      memberBatchIds: [fixture.batchId], window: { start: "2026-06-01", end: "2026-06-16" },
      contenders: [{ contenderKind: "draft", removalId: fixture.removalId, createdAt: "2026-06-16",
        creditBatchIds: [fixture.batchId], window: { start: "2026-06-01", end: "2026-06-16" } }],
      entries, lineSources: observation.lineSources,
      monitoredInputs: [{ componentId: "line", inputKey: "electricity_use", unit: "kWh" }],
    });
    const candidates = await collectCandidateSourceDocumentsForRemoval(ctx, {
      removalId: fixture.removalId, lineages: [], entryContributions: contributions,
    });
    const evidence = await planRemovalEvidence({ orgCtx: ctx, removalId: fixture.removalId,
      ctx: { lineages: [], memberBatchClaims: [], batchesWithSamples: [],
        removalEntryContext: { contributions } } as never,
      template: { groups: [{ key: "pyrolysis", components: [{ id: "line", blueprint_key: "grid_electricity_use",
        inputs: [{ input_key: "electricity_use", type: "monitored" }] }] }] } as never,
      compiledBiocharApplicationIntents: [], supplied: { candidateSourceDocuments: candidates,
        sourceBindingCandidates: candidates.map((candidate) => ({ ...candidate, sourceId: "source-entry-file" })) },
    });
    expect(evidence.sourceBindingPlan).toMatchObject([{ documentId: document.id, nomaRole: "emission_entry",
      lineage: { entityId: entry.id }, intendedTarget: { componentId: "line", inputKey: "electricity_use" } }]);
    expect(evidence.sourceBindingPlan).toHaveLength(1);
  } finally {
    await db.delete(documents).where(and(eq(documents.organizationId, ctx.organizationId), eq(documents.id, document.id)));
  }
});

it("finds an uploaded manifest file behind more than the listing cap of pending documents", async () => {
  const entry = await value();
  const document = await insertDocument(ctx, { entityType: "emission_entry", entityId: entry.id,
    documentType: "pdf", fileName: "Manifest evidence.pdf", fileUrl: "https://example.test/evidence.pdf" });
  // The operator listing caps at 200, regardless of upload status.
  try {
    await db.insert(documents).values(Array.from({ length: NEWER_DOCUMENT_COUNT }, (_, index) => ({
      organizationId: ctx.organizationId, entityType: "emission_entry" as const, entityId: entry.id,
      documentType: "pdf" as const, fileName: "Pending.pdf", fileUrl: "", uploadStatus: "pending" as const,
      storageProvider: "local-fs", storageBucket: "test",
      storageKey: `pending/${entry.id}/${index}`, uploadStorageKey: `uploads/${entry.id}/${index}`,
      createdAt: new Date("2099-01-01"),
    })));
    expect((await listDocumentsForEntity(ctx, "emission_entry", entry.id)).some((row) => row.id === document.id)).toBe(false);
    const { entries } = await loadBatchEmissionEntryFacts(ctx, fixture.batchId, observation);
    const contributions = deriveRemovalEntryContributions({ removalId: fixture.removalId,
      memberBatchIds: [fixture.batchId], window: { start: "2026-06-01", end: "2026-06-16" },
      contenders: [{ contenderKind: "draft", removalId: fixture.removalId, createdAt: "2026-06-16",
        creditBatchIds: [fixture.batchId], window: { start: "2026-06-01", end: "2026-06-16" } }],
      entries, lineSources: observation.lineSources,
      monitoredInputs: [{ componentId: "line", inputKey: "electricity_use", unit: "kWh" }],
    });
    expect(contributions.manifest[0].entries[0].evidenceDocumentIds).toEqual([document.id]);
    expect(await collectCandidateSourceDocumentsForRemoval(ctx, {
      removalId: fixture.removalId, lineages: [], entryContributions: contributions,
    })).toMatchObject([{ documentId: document.id }]);
    expect(await listEmissionEntryDocumentsByIds({ ...ctx, organizationId: "other-organization" }, [entry.id], [document.id])).toEqual([]);
    expect(await listEmissionEntryDocumentsByIds(ctx, [crypto.randomUUID()], [document.id])).toEqual([]);
    await db.update(documents).set({ entityType: "credit_batch", entityId: fixture.batchId })
      .where(and(eq(documents.organizationId, ctx.organizationId), eq(documents.id, document.id)));
    expect(await listEmissionEntryDocumentsByIds(ctx, [fixture.batchId], [document.id])).toEqual([]);
  } finally {
    await db.delete(documents).where(and(eq(documents.organizationId, ctx.organizationId),
      or(eq(documents.id, document.id), and(eq(documents.entityType, "emission_entry"), eq(documents.entityId, entry.id)))));
  }
});

it.each(["writable", "reserved", "sent"] as const)("upload confirmation preserves the frozen evidence contract for a %s entry", async (state) => {
  const entry = await value();
  const fileBytes = Buffer.from("%PDF-1.7");
  const document = await db.transaction((tx) => requestDocumentUploadInTransaction(ctx, tx, {
    entityType: "emission_entry", entityId: entry.id, documentType: "pdf", fileName: "Evidence.pdf",
    contentType: "application/pdf", sizeBytes: fileBytes.length, storageProvider: "local-fs", storageBucket: "test",
  }));
  try {
    const before = await getEmissionEntry(ctx, entry.id);
    expect(before.contentRevision).toBe(entry.contentRevision);
    expect((await loadBatchEmissionEntryFacts(ctx, fixture.batchId, observation)).entries[0].evidenceDocumentIds).toEqual([]);
    if (state !== "writable") {
      const attempt = await draft([{ entryId: entry.id, contentRevision: before.contentRevision }]);
      await reserve(attempt);
      if (state === "sent") await markSubmissionSubmitted(ctx, attempt.id, { externalId: "upload-confirm-fixture", expectedLockedAt: attempt.lockedAt!,
        productionEmissionsClaim: { removalId: fixture.removalId, creditBatchIds: [fixture.batchId] } });
    }
    // Simulate the inspected storage boundary; this test exercises the locked DB transition.
    const facts = { ...uploadFactsFor(document), finalKey: `objects/${document.id}/confirmed.pdf`,
      inspectedSizeBytes: fileBytes.length, inspectedSha256: "fixture-checksum", inspectedContentType: "application/pdf" };
    const result = await db.transaction((tx) => confirmDocumentUploadInTransaction(ctx, tx, facts));
    const after = await getEmissionEntry(ctx, entry.id);
    const evidence = (await loadBatchEmissionEntryFacts(ctx, fixture.batchId, observation)).entries[0].evidenceDocumentIds;
    if (state === "writable") {
      expect(result).toMatchObject({ kind: "uploaded", transitioned: true });
      expect(after.contentRevision).toBe(before.contentRevision + 1);
      expect(evidence).toEqual([document.id]);
      expect(await db.transaction((tx) => confirmDocumentUploadInTransaction(ctx, tx, facts))).toMatchObject({ kind: "uploaded", transitioned: false });
      expect((await getEmissionEntry(ctx, entry.id)).contentRevision).toBe(after.contentRevision);
    } else {
      expect(result).toMatchObject({ kind: "refused", reason: "certification_locked", document: { uploadStatus: "failed" } });
      expect(after.contentRevision).toBe(before.contentRevision);
      expect(evidence).toEqual([]);
    }
  } finally {
    await cleanupDocumentUploads(ctx, [document.id]);
  }
});
