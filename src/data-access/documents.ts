import { and, desc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, productionRuns } from "@/db/schema";
import { SafeError } from "@/lib/errors";
import { requireAuth } from "./utils";

/**
 * Hard cap on documents returned for a single entity. This is a guardrail
 * against unbounded scans — NOT pagination. Full pagination is tracked
 * separately (architecture audit, Phase 3).
 */
const MAX_DOCUMENTS_PER_ENTITY = 200;

export type DocumentRow = typeof documents.$inferSelect;
export type NewDocumentRow = typeof documents.$inferInsert;

export async function assertCanManageDocumentEntity(
  userId: string,
  entityType: string,
  entityId: string
): Promise<void> {
  requireAuth(userId);

  if (entityType !== "production_run") return;

  const [run] = await db
    .select({ id: productionRuns.id })
    .from(productionRuns)
    .where(and(eq(productionRuns.id, entityId), isNull(productionRuns.archivedAt)));

  if (!run) {
    throw new SafeError("Production run not found or archived");
  }
}

export async function listDocumentsForEntity(
  userId: string,
  entityType: string,
  entityId: string
): Promise<DocumentRow[]> {
  requireAuth(userId);
  await assertCanManageDocumentEntity(userId, entityType, entityId);
  return db
    .select()
    .from(documents)
    .where(
      and(eq(documents.entityType, entityType), eq(documents.entityId, entityId))
    )
    .orderBy(desc(documents.createdAt))
    .limit(MAX_DOCUMENTS_PER_ENTITY);
}

export async function listDocumentsForEntityIds(
  userId: string,
  entityType: string,
  entityIds: string[],
): Promise<DocumentRow[]> {
  requireAuth(userId);
  if (entityIds.length === 0) return [];

  const rankedDocuments = db
    .select({
      ...getTableColumns(documents),
      documentRank: sql<number>`row_number() over (
        partition by ${documents.entityId}
        order by ${documents.createdAt} desc
      )`.as("document_rank"),
    })
    .from(documents)
    .where(
      and(
        eq(documents.entityType, entityType),
        inArray(documents.entityId, entityIds),
      ),
    )
    .as("ranked_documents");

  return db
    .select({
      id: rankedDocuments.id,
      entityType: rankedDocuments.entityType,
      entityId: rankedDocuments.entityId,
      documentType: rankedDocuments.documentType,
      storageProvider: rankedDocuments.storageProvider,
      storageBucket: rankedDocuments.storageBucket,
      storageKey: rankedDocuments.storageKey,
      fileUrl: rankedDocuments.fileUrl,
      fileName: rankedDocuments.fileName,
      fileSizeBytes: rankedDocuments.fileSizeBytes,
      mimeType: rankedDocuments.mimeType,
      checksumSha256: rankedDocuments.checksumSha256,
      visibility: rankedDocuments.visibility,
      uploadStatus: rankedDocuments.uploadStatus,
      issuedAt: rankedDocuments.issuedAt,
      capturedAt: rankedDocuments.capturedAt,
      description: rankedDocuments.description,
      metadata: rankedDocuments.metadata,
      createdBy: rankedDocuments.createdBy,
      notes: rankedDocuments.notes,
      createdAt: rankedDocuments.createdAt,
      updatedAt: rankedDocuments.updatedAt,
    })
    .from(rankedDocuments)
    .where(sql`${rankedDocuments.documentRank} <= ${MAX_DOCUMENTS_PER_ENTITY}`)
    .orderBy(desc(rankedDocuments.createdAt));
}

export async function getDocumentById(
  userId: string,
  id: string
): Promise<DocumentRow | null> {
  requireAuth(userId);
  const [row] = await db.select().from(documents).where(eq(documents.id, id));
  return row ?? null;
}

/**
 * Unauthenticated lookup used by the public document proxy route. Returns the
 * row only when visibility is "public"; callers must use getDocumentById for
 * any private-document access.
 */
export async function getPublicDocumentById(
  id: string
): Promise<DocumentRow | null> {
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.visibility, "public")));
  return row ?? null;
}

export async function insertDocument(
  userId: string,
  input: NewDocumentRow
): Promise<DocumentRow> {
  requireAuth(userId);
  const [row] = await db.insert(documents).values(input).returning();
  return row;
}

export async function updateDocument(
  userId: string,
  id: string,
  patch: Partial<NewDocumentRow>
): Promise<DocumentRow | null> {
  requireAuth(userId);
  const [row] = await db
    .update(documents)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(documents.id, id))
    .returning();
  return row ?? null;
}

export async function deleteDocumentRow(
  userId: string,
  id: string
): Promise<DocumentRow | null> {
  requireAuth(userId);
  const [row] = await db
    .delete(documents)
    .where(eq(documents.id, id))
    .returning();
  return row ?? null;
}
