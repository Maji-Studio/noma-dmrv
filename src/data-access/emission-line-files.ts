import { and, asc, eq, inArray } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { documents, emissionLineFiles } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import {
  emissionLineFileAnchorSchema, attachEmissionLineFileSchema, removeEmissionLineFileSchema,
  type EmissionLineFileAnchorInput, type AttachEmissionLineFileInput, type RemoveEmissionLineFileInput,
} from "@/schemas/emission-line-files";
import { requireOrgScope, type Executor } from "./utils";
import { lockEmissionLineFileBatch } from "./emission-line-file-lock";
import { requestDocumentUploadInTransaction } from "./document-writes";
import { deleteDocumentInTransaction } from "./document-mutations";
import { recordDocumentActivity } from "./write-activity";

export async function listEmissionLineFiles(ctx: OrgContext, creditBatchId: string, executor: Executor = db) {
  requireOrgScope(ctx);
  return listEmissionLineFilesForBatches(ctx, [creditBatchId], executor);
}

/** Includes empty anchors and only confirmed files; pending uploads are not proof. */
export async function listEmissionLineFilesForBatches(ctx: OrgContext, creditBatchIds: string[], executor: Executor = db) {
  requireOrgScope(ctx);
  if (!creditBatchIds.length) return [];
  return executor.select({ anchor: emissionLineFiles, document: documents }).from(emissionLineFiles)
    .leftJoin(documents, and(eq(documents.organizationId, ctx.organizationId), eq(documents.entityType, "emission_line"),
      eq(documents.entityId, emissionLineFiles.id), eq(documents.uploadStatus, "uploaded")))
    .where(and(eq(emissionLineFiles.organizationId, ctx.organizationId), inArray(emissionLineFiles.creditBatchId, creditBatchIds)))
    .orderBy(asc(emissionLineFiles.id), asc(documents.id));
}

export async function getOrCreateEmissionLineFile(ctx: OrgContext, input: EmissionLineFileAnchorInput, tx?: DbTransaction): Promise<typeof emissionLineFiles.$inferSelect> {
  requireOrgScope(ctx);
  const data = emissionLineFileAnchorSchema.parse(input);
  if (!tx) return db.transaction(transaction => getOrCreateEmissionLineFile(ctx, data, transaction));
  await lockEmissionLineFileBatch(ctx, tx, data.creditBatchId, data.componentId);
  const [existing] = await tx.select().from(emissionLineFiles).where(and(
    eq(emissionLineFiles.organizationId, ctx.organizationId), eq(emissionLineFiles.creditBatchId, data.creditBatchId),
    eq(emissionLineFiles.componentId, data.componentId),
  )).for("update");
  if (existing) return existing;
  const [anchor] = await tx.insert(emissionLineFiles).values({ ...data,
    organizationId: ctx.organizationId, createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning();
  return anchor;
}

/** Begins the existing upload protocol. Clients PUT the bytes, then use confirmUpload. */
export async function attachEmissionLineFile(ctx: OrgContext, input: AttachEmissionLineFileInput,
  storage: { storageProvider: string; storageBucket: string }) {
  requireOrgScope(ctx);
  const data = attachEmissionLineFileSchema.parse(input);
  return db.transaction(async tx => {
    const anchor = await getOrCreateEmissionLineFile(ctx, data, tx);
    const document = await requestDocumentUploadInTransaction(ctx, tx, {
      ...data.upload, ...storage, entityType: "emission_line", entityId: anchor.id,
    });
    await recordDocumentActivity(ctx, tx, document, "created", { source: "form" });
    return document;
  });
}

/** Unsent files may be removed; correct sent evidence by adding another file. */
export async function removeEmissionLineFile(ctx: OrgContext, input: RemoveEmissionLineFileInput) {
  requireOrgScope(ctx);
  const data = removeEmissionLineFileSchema.parse(input);
  return db.transaction(async tx => {
    const [document] = await tx.select().from(documents).where(and(
      eq(documents.organizationId, ctx.organizationId), eq(documents.id, data.documentId), eq(documents.entityType, "emission_line"),
    ));
    if (!document) throw new DomainError("not_found", "Component file was not found.");
    const removed = await deleteDocumentInTransaction(ctx, tx, data);
    await recordDocumentActivity(ctx, tx, removed, "deleted", { source: "form" });
    return { id: removed.id };
  });
}
