import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { DbTransaction } from "@/db";
import { certifierDocumentUploads, documents } from "@/db/schema";
import { hasOrgRole, type OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";
import { acquireMirrorLock } from "@/lib/isometric/utils/source-lock";
import { metadataRecord } from "@/lib/documents/metadata";
import { setVisibilitySchema, updateApplicationEvidenceMetadataSchema } from "@/schemas/documents";
import { releaseUnreferencedIsometricMapping, type DocumentRow } from "./documents";
import { assertDocumentOwnerWritable, documentNotFound, lockDocumentOwner, readDocumentForWrite } from "./document-write-scope";
import { enqueueDocumentKeys } from "./document-storage-deletions";
import { assertRowVersion } from "./row-version";
import { requireOrgScope } from "./utils";
async function lockDocument(ctx: OrgContext, tx: DbTransaction, id: string, deleting = false): Promise<DocumentRow> {
  const initial = await readDocumentForWrite(ctx, tx, id);
  if (!initial) throw documentNotFound();
  const scope = await lockDocumentOwner(ctx, tx, initial.entityType, initial.entityId);
  if (deleting) await acquireMirrorLock(tx, id);
  const row = await readDocumentForWrite(ctx, tx, id, true);
  if (!row) throw documentNotFound();
  if (row.entityType !== initial.entityType || row.entityId !== initial.entityId) throw new DomainError("conflict", "Certification lineage changed while it was being locked. Refresh and retry.", { retryable: true });
  await assertDocumentOwnerWritable(ctx, tx, scope, deleting);
  return row;
}
export async function deleteDocumentInTransaction(ctx: OrgContext, tx: DbTransaction, input: { documentId: string; expectedVersion?: number }): Promise<DocumentRow> {
  requireOrgScope(ctx);
  const row = await lockDocument(ctx, tx, input.documentId, true);
  if (input.expectedVersion !== undefined) assertRowVersion({ entity: "document", id: row.id, expectedVersion: input.expectedVersion, actualVersion: row.version });
  const release = await releaseUnreferencedIsometricMapping(ctx, tx, row.id);
  if (release !== "released") throw new DomainError("certification_locked", release === "reviewed-evidence" ? "This document belongs to reviewed certification evidence and cannot be deleted or replaced." : "This document belongs to submitted certification history and cannot be deleted or replaced. The Isometric Source and audit history remain unchanged.");
  const [mapping] = await tx.select({ id: certifierDocumentUploads.id }).from(certifierDocumentUploads).where(and(eq(certifierDocumentUploads.documentId, row.id), eq(certifierDocumentUploads.organizationId, ctx.organizationId))).limit(1);
  if (mapping) throw new DomainError("conflict", "This document is mirrored to a certification provider and cannot be deleted.");
  await enqueueDocumentKeys(ctx, tx, row);
  await tx.delete(documents).where(and(eq(documents.id, row.id), eq(documents.organizationId, ctx.organizationId)));
  return row;
}
export async function setDocumentVisibilityInTransaction(ctx: OrgContext, tx: DbTransaction, input: z.infer<typeof setVisibilitySchema>): Promise<DocumentRow> {
  requireOrgScope(ctx);
  if (!hasOrgRole(ctx, "admin")) throw new DomainError("forbidden", "Only organization owners and admins can change file visibility.");
  const data = setVisibilitySchema.parse(input);
  const row = await lockDocument(ctx, tx, data.documentId);
  const [saved] = await tx.update(documents).set({ visibility: data.visibility, version: row.version + 1, updatedAt: new Date() }).where(and(eq(documents.id, row.id), eq(documents.organizationId, ctx.organizationId))).returning();
  return saved;
}
export async function updateApplicationEvidenceMetadataInTransaction(ctx: OrgContext, tx: DbTransaction, input: z.infer<typeof updateApplicationEvidenceMetadataSchema>): Promise<DocumentRow> {
  requireOrgScope(ctx);
  const data = updateApplicationEvidenceMetadataSchema.parse(input);
  const row = await lockDocument(ctx, tx, data.documentId);
  if (row.entityType !== "application") throw new SafeError("Evidence classification is only available for applications");
  const patch: Record<string, unknown> = {};
  if (data.applicationEvidenceRole !== undefined) {
    if (row.documentType !== "photo") throw new SafeError("Visual evidence role can only be set on photos");
    patch.evidenceRole = data.applicationEvidenceRole;
  }
  if (data.applicationLogbookEvidenceType !== undefined) {
    if (!["pdf", "weighbridge_ticket", "affidavit"].includes(row.documentType)) throw new SafeError("Boundary logbook evidence type can only be set on logbook documents");
    patch.logbookEvidenceType = data.applicationLogbookEvidenceType;
  }
  const [saved] = await tx.update(documents).set({ metadata: { ...metadataRecord(row.metadata), ...patch }, version: row.version + 1, updatedAt: new Date() }).where(and(eq(documents.id, row.id), eq(documents.organizationId, ctx.organizationId))).returning();
  return saved;
}
