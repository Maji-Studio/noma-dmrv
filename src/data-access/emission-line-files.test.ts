import { buildRemovalSourceBindingPlan } from "@/lib/certification/removal-source-bindings";
import { lineFileEvidenceFacts } from "../../tests/helpers/line-file-evidence-facts";
import { loadRemovalSourceContext } from "@/lib/certification/emission-entry-source-context";
import { lineFileSourceCandidates } from "@/lib/certification/emission-line-file-evidence";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, certifierDocumentUploads, certificationSubmissions, creditBatches, documents, emissionLineFiles, productionRuns } from "@/db/schema";
import { deleteCreditBatch } from "./credit-batches";
import { replaceEmissionLineFiles, attachEmissionLineFile, getOrCreateEmissionLineFile, listEmissionLineFiles, listEmissionLineFilesForBatches, removeEmissionLineFile } from "./emission-line-files";
import { setComponentFilePolicy } from "./component-file-policy";
import { confirmDocumentUploadInTransaction, requestDocumentUploadInTransaction, uploadFactsFor } from "./document-writes";
import { deleteDocumentInTransaction } from "./document-mutations";
import { createEmissionLineFileFixture, cleanupEmissionLineFileFixture, claimEmissionLineFileFixture,
  COMPONENT_ID, FILE_UPLOAD, FILE_STORAGE, STATEMENT_SENT_AT, type EmissionLineFileFixture } from "../../tests/helpers/emission-line-file-fixture";

// Only the registry boundary is stubbed. Locks, ownership, policies and documents use PostgreSQL.
const remote = vi.hoisted(() => ({ status: "FAILED_VERIFICATION", ghg_entry_ids: [] as string[], submitted_at: "" }));
vi.mock("@/lib/isometric/ghg-statements", () => ({ getGhgStatement: async () => remote }));
vi.mock("@/data-access/certifier-credentials", () => ({ resolveIsometricClient: async () => ({}) }));
let fixture: EmissionLineFileFixture;
beforeEach(async () => {
  fixture = await createEmissionLineFileFixture();
  remote.status = "FAILED_VERIFICATION";
  remote.submitted_at = STATEMENT_SENT_AT;
  remote.ghg_entry_ids = [];
});
afterEach(async () => {
  if (!fixture) return;
  await db.delete(certifierDocumentUploads).where(eq(certifierDocumentUploads.organizationId, fixture.ctx.organizationId));
  await cleanupEmissionLineFileFixture(fixture);
});
const anchorInput = () => ({ creditBatchId: fixture.batch.id, componentId: COMPONENT_ID });
const attach = () => attachEmissionLineFile(fixture.ctx, { ...anchorInput(), upload: FILE_UPLOAD }, FILE_STORAGE);
async function confirm(row: typeof documents.$inferSelect) {
  return db.transaction(tx => confirmDocumentUploadInTransaction(fixture.ctx, tx, { ...uploadFactsFor(row),
    finalKey: `confirmed/${row.id}`, inspectedSizeBytes: FILE_UPLOAD.sizeBytes,
    inspectedContentType: FILE_UPLOAD.contentType, inspectedSha256: "a".repeat(64),
  }));
}
async function uploaded() {
  const pending = await attach();
  const outcome = await confirm(pending);
  if (outcome.kind !== "uploaded") throw new Error("Fixture upload was refused");
  return outcome.document;
}

it("reuses the UUID anchor, confirms through the shared writer, and records ID-only activity", async () => {
  const anchor = await getOrCreateEmissionLineFile(fixture.ctx, anchorInput());
  expect(await getOrCreateEmissionLineFile(fixture.ctx, anchorInput())).toEqual(anchor);
  const pending = await attach();
  expect(pending).toMatchObject({ entityType: "emission_line", entityId: anchor.id, uploadStatus: "pending" });
  expect((await listEmissionLineFiles(fixture.ctx, fixture.batch.id))[0].document).toBeNull();
  const result = await confirm(pending);
  expect(result.kind).toBe("uploaded");
  expect((await listEmissionLineFilesForBatches(fixture.ctx, [fixture.batch.id]))[0]).toMatchObject({
    anchor: { id: anchor.id, version: anchor.version + 1 }, document: { id: pending.id, uploadStatus: "uploaded" },
  });
  const [document] = await db.select().from(documents).where(and(eq(documents.organizationId, fixture.ctx.organizationId), eq(documents.id, pending.id)));
  await removeEmissionLineFile(fixture.ctx, { documentId: document.id, expectedVersion: document.version });
  const events = await db.select().from(activityEvents).where(and(eq(activityEvents.organizationId, fixture.ctx.organizationId), eq(activityEvents.entityId, document.id)));
  expect(events.map(row => row.action).sort()).toEqual(["created", "deleted"]);
  for (const event of events) {
    expect(event.creditBatchId).toBe(fixture.batch.id);
    expect(event.reasonCode).toBe(`document:pdf:emission_line:${anchor.id}`);
    expect(JSON.stringify(event, (_key, value) => typeof value === "bigint" ? value.toString() : value)).not.toContain(FILE_UPLOAD.fileName);
  }
});

it("requires scope and refuses foreign batch, anchor and document IDs", async () => {
  const document = await uploaded();
  const foreign = { ...fixture.ctx, organizationId: `foreign-${crypto.randomUUID()}` };
  const unscoped = { ...fixture.ctx, organizationId: "" };
  await expect(listEmissionLineFilesForBatches(unscoped, [])).rejects.toThrow("Unauthorized");
  await expect(getOrCreateEmissionLineFile(unscoped, anchorInput())).rejects.toThrow("Unauthorized");
  await expect(attachEmissionLineFile(unscoped, { ...anchorInput(), upload: FILE_UPLOAD }, FILE_STORAGE)).rejects.toThrow("Unauthorized");
  await expect(removeEmissionLineFile(unscoped, { documentId: document.id, expectedVersion: document.version })).rejects.toThrow("Unauthorized");
  expect(await listEmissionLineFiles(foreign, fixture.batch.id)).toEqual([]);
  await expect(getOrCreateEmissionLineFile(foreign, anchorInput())).rejects.toMatchObject({ code: "not_found" });
  await expect(attachEmissionLineFile(foreign, { ...anchorInput(), upload: FILE_UPLOAD }, FILE_STORAGE)).rejects.toMatchObject({ code: "not_found" });
  await expect(removeEmissionLineFile(foreign, { documentId: document.id, expectedVersion: document.version })).rejects.toMatchObject({ code: "not_found" });
  await expect(db.transaction(tx => requestDocumentUploadInTransaction(foreign, tx, {
    ...FILE_UPLOAD, ...FILE_STORAGE, entityType: "emission_line", entityId: document.entityId,
  }))).rejects.toMatchObject({ code: "not_found" });
});

it("refuses attach, confirmation and removal after the proof setting changes", async () => {
  const pending = await attach();
  await setComponentFilePolicy(fixture.ctx, { observationId: fixture.observation.id, componentId: COMPONENT_ID,
    filePolicy: "entryFiles", expectedVersion: fixture.observation.version });
  await expect(attach()).rejects.toMatchObject({ code: "validation_failed" });
  await expect(confirm(pending)).rejects.toMatchObject({ code: "validation_failed" });
  await expect(removeEmissionLineFile(fixture.ctx, { documentId: pending.id, expectedVersion: pending.version })).rejects.toMatchObject({ code: "validation_failed" });
});

it.each(["claimed", "reserved"] as const)("locks all file writers when production emissions are %s", async kind => {
  const document = await uploaded();
  const [{ anchor }] = await listEmissionLineFiles(fixture.ctx, fixture.batch.id);
  await claimEmissionLineFileFixture(fixture, kind);
  await expect(replaceEmissionLineFiles(fixture.ctx, { ...anchorInput(), expectedVersion: anchor.version })).rejects.toMatchObject({ code: "certification_locked" });
  await expect(attach()).rejects.toMatchObject({ code: "certification_locked" });
  await expect(removeEmissionLineFile(fixture.ctx, { documentId: document.id, expectedVersion: document.version })).rejects.toMatchObject({ code: "certification_locked" });
  await expect(db.transaction(tx => deleteDocumentInTransaction(fixture.ctx, tx, { documentId: document.id, expectedVersion: document.version })))
    .rejects.toMatchObject({ code: "certification_locked" });
});

it.each(["claimed", "reserved"] as const)("refuses a pending confirmation when emissions become %s", async kind => {
  const pending = await attach();
  await claimEmissionLineFileFixture(fixture, kind);
  expect(await confirm(pending)).toMatchObject({ kind: "refused", reason: "certification_locked" });
});

it("allows remove and attach while the claiming Removal's correction window is open, then locks again", async () => {
  const document = await uploaded();
  const { externalId } = await claimEmissionLineFileFixture(fixture, "returned");
  remote.ghg_entry_ids = [externalId];
  await removeEmissionLineFile(fixture.ctx, { documentId: document.id, expectedVersion: document.version });
  const replacement = await uploaded();
  expect(replacement.entityId).toBe(document.entityId);
  expect(replacement.id).not.toBe(document.id);
  remote.status = "AWAITING_VERIFICATION";
  await expect(removeEmissionLineFile(fixture.ctx, { documentId: replacement.id, expectedVersion: replacement.version }))
    .rejects.toMatchObject({ code: "certification_locked" });
});

it("ignores an inactive reservation but preserves an active reservation", async () => {
  const { submission } = await claimEmissionLineFileFixture(fixture, "reserved");
  await expect(attach()).rejects.toMatchObject({ code: "certification_locked" });
  await db.update(certificationSubmissions).set({ status: "rejected", lockedAt: null }).where(and(
    eq(certificationSubmissions.organizationId, fixture.ctx.organizationId), eq(certificationSubmissions.id, submission.id),
  ));
  await expect(attach()).resolves.toMatchObject({ uploadStatus: "pending" });
});

it("concurrent uploads both succeed and both count, while stale deletion is refused", async () => {
  const pending = await Promise.all([attach(), attach()]);
  expect(pending[0].entityId).toBe(pending[1].entityId);
  expect(pending[0].id).not.toBe(pending[1].id);
  const confirmed = await Promise.all(pending.map(confirm));
  expect(confirmed.map(result => result.kind)).toEqual(["uploaded", "uploaded"]);
  const rows = await listEmissionLineFilesForBatches(fixture.ctx, [fixture.batch.id]);
  expect(rows.map(row => row.document?.id).sort()).toEqual(pending.map(row => row.id).sort());
  const document = rows[0].document!;
  await expect(removeEmissionLineFile(fixture.ctx, { documentId: document.id, expectedVersion: document.version + 1 }))
    .rejects.toMatchObject({ code: "stale_version" });
  await expect(db.transaction(tx => requestDocumentUploadInTransaction(fixture.ctx, tx, {
    ...FILE_UPLOAD, ...FILE_STORAGE, entityType: "emission_line", entityId: document.entityId,
  }))).resolves.toMatchObject({ uploadStatus: "pending" });
});

it("retires the component file when its credit batch is deleted", async () => {
  const document = await uploaded();
  const [batch] = await db.select().from(creditBatches).where(and(
    eq(creditBatches.organizationId, fixture.ctx.organizationId), eq(creditBatches.id, fixture.batch.id),
  ));
  await deleteCreditBatch(fixture.ctx, batch.id, batch.version);
  await expect(db.select().from(documents).where(and(
    eq(documents.organizationId, fixture.ctx.organizationId), eq(documents.id, document.id),
  ))).resolves.toEqual([]);
  await expect(db.select().from(emissionLineFiles).where(eq(emissionLineFiles.organizationId, fixture.ctx.organizationId)))
    .resolves.toEqual([]);
});

it("replaces the live set while keeping the sent file and Source history", async () => {
  const electricityKwh = 1;
  await db.update(productionRuns).set({ electricityKwh }).where(and(
    eq(productionRuns.organizationId, fixture.ctx.organizationId), eq(productionRuns.id, fixture.run.id),
  ));
  const sent = await uploaded();
  const sourceId = `source-${sent.id}`;
  const { externalId } = await claimEmissionLineFileFixture(fixture, "returned", { sourceBindingPlan: [{ sourceId }] });
  remote.ghg_entry_ids = [externalId];
  await db.insert(certifierDocumentUploads).values({ organizationId: fixture.ctx.organizationId,
    documentId: sent.id, provider: "isometric", externalDocumentId: sourceId });
  await expect(removeEmissionLineFile(fixture.ctx, { documentId: sent.id, expectedVersion: sent.version }))
    .rejects.toMatchObject({ code: "certification_locked" });
  const unsent = await uploaded();
  const pending = await attach();
  const [{ anchor }] = await listEmissionLineFiles(fixture.ctx, fixture.batch.id);
  await expect(replaceEmissionLineFiles(fixture.ctx, { ...anchorInput(), expectedVersion: anchor.version + 1 }))
    .rejects.toMatchObject({ code: "stale_version" });
  await replaceEmissionLineFiles(fixture.ctx, { ...anchorInput(), expectedVersion: anchor.version });
  const [retired] = await db.select().from(emissionLineFiles).where(and(
    eq(emissionLineFiles.organizationId, fixture.ctx.organizationId), eq(emissionLineFiles.id, anchor.id),
  ));
  expect(retired).toMatchObject({ retiredAt: expect.any(Date), retiredBy: fixture.ctx.userId });
  expect(await listEmissionLineFiles(fixture.ctx, fixture.batch.id)).toEqual([]);
  const retained = await db.select().from(documents).where(and(
    eq(documents.organizationId, fixture.ctx.organizationId), eq(documents.entityId, anchor.id),
  ));
  expect(retained.map(file => file.id)).toEqual([sent.id]);
  expect(retained.map(file => file.id)).not.toContain(unsent.id);
  expect(retained.map(file => file.id)).not.toContain(pending.id);
  await expect(db.transaction(tx => requestDocumentUploadInTransaction(fixture.ctx, tx, {
    ...FILE_UPLOAD, ...FILE_STORAGE, entityType: "emission_line", entityId: anchor.id,
  }))).rejects.toMatchObject({ code: "certification_locked" });
  await expect(removeEmissionLineFile(fixture.ctx, { documentId: sent.id, expectedVersion: sent.version }))
    .rejects.toMatchObject({ code: "certification_locked", message: "These files were replaced. Add files to the current set." });
  const corrected = await uploaded();
  expect(corrected.entityId).not.toBe(sent.entityId);
  const rows = await listEmissionLineFilesForBatches(fixture.ctx, [fixture.batch.id]);
  expect(rows.map(row => row.document?.id)).toEqual([corrected.id]);
  const context = (await loadRemovalSourceContext(fixture.ctx, fixture.removal.id))!;
  expect(context.lineFileEvidence.map(file => file.documentId)).toEqual([corrected.id]);
  const candidates = lineFileSourceCandidates(context.lineFileEvidence).map(file => ({ ...file, sourceId: `source-${file.documentId}` }));
  const { template } = lineFileEvidenceFacts();
  template.groups[0].components[0].id = COMPONENT_ID;
  const plan = buildRemovalSourceBindingPlan({ template, lineSources: fixture.observation.lineSources,
    lineFileEvidence: context.lineFileEvidence, candidates, applicationIdsByCreditBatchId: new Map() });
  expect(plan.map(binding => binding.documentId)).toEqual([corrected.id]);
  const events = await db.select().from(activityEvents).where(and(
    eq(activityEvents.organizationId, fixture.ctx.organizationId), eq(activityEvents.entityId, anchor.id),
  ));
  expect(events).toEqual([expect.objectContaining({ reasonCode: "component-files-replaced" })]);
  const mappings = await db.select().from(certifierDocumentUploads).where(eq(certifierDocumentUploads.organizationId, fixture.ctx.organizationId));
  expect(mappings).toMatchObject([{ documentId: sent.id, externalDocumentId: sourceId }]);
});

it.each(["resubmitting", "retained"])("locks attach, confirmation and deletion during a returned Removal's active reservation (%s)", async kind => {
  const document = await uploaded();
  const pending = await attach();
  const { externalId, submission } = await claimEmissionLineFileFixture(fixture, "returned");
  remote.ghg_entry_ids = [externalId];
  if (kind === "resubmitting") await claimEmissionLineFileFixture(fixture, "reserved");
  else {
    // A sent attempt is not transferable even after its correction window opens.
    await db.update(creditBatches).set({ productionEmissionsClaimReservedBySubmissionId: submission.id }).where(and(
      eq(creditBatches.organizationId, fixture.ctx.organizationId), eq(creditBatches.id, fixture.batch.id),
    ));
  }
  const [{ anchor }] = await listEmissionLineFiles(fixture.ctx, fixture.batch.id);
  await expect(replaceEmissionLineFiles(fixture.ctx, { ...anchorInput(), expectedVersion: anchor.version }))
    .rejects.toMatchObject({ code: "certification_locked" });
  await expect(attach()).rejects.toMatchObject({ code: "certification_locked" });
  expect(await confirm(pending)).toMatchObject({ kind: "refused", reason: "certification_locked" });
  await expect(removeEmissionLineFile(fixture.ctx, { documentId: document.id, expectedVersion: document.version }))
    .rejects.toMatchObject({ code: "certification_locked" });
});

it("allows deleting unsent files on an archived batch but refuses request and confirm", async () => {
  const document = await uploaded();
  const pending = await attach();
  await db.update(creditBatches).set({ archivedAt: new Date() }).where(and(
    eq(creditBatches.organizationId, fixture.ctx.organizationId), eq(creditBatches.id, fixture.batch.id),
  ));
  await expect(db.transaction(tx => requestDocumentUploadInTransaction(fixture.ctx, tx, {
    ...FILE_UPLOAD, ...FILE_STORAGE, entityType: "emission_line", entityId: document.entityId,
  }))).rejects.toMatchObject({ code: "not_found" });
  expect(await confirm(pending)).toMatchObject({ kind: "gone" });
  await expect(removeEmissionLineFile(fixture.ctx, { documentId: document.id, expectedVersion: document.version }))
    .resolves.toEqual({ id: document.id });
});

it("refuses confirmation on a retired anchor even for a retained pending document", async () => {
  const pending = await attach();
  await db.insert(certifierDocumentUploads).values({ organizationId: fixture.ctx.organizationId,
    documentId: pending.id, provider: "isometric", externalDocumentId: `source-${pending.id}` });
  const anchor = await getOrCreateEmissionLineFile(fixture.ctx, anchorInput());
  await replaceEmissionLineFiles(fixture.ctx, { ...anchorInput(), expectedVersion: anchor.version });
  expect(await confirm(pending)).toMatchObject({ kind: "refused", reason: "certification_locked" });
});
