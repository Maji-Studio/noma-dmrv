import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { requireAuth } from "./utils";

export type DocumentRow = typeof documents.$inferSelect;
export type NewDocumentRow = typeof documents.$inferInsert;

export async function listDocumentsForEntity(
  userId: string,
  entityType: string,
  entityId: string
): Promise<DocumentRow[]> {
  requireAuth(userId);
  return db
    .select()
    .from(documents)
    .where(
      and(eq(documents.entityType, entityType), eq(documents.entityId, entityId))
    )
    .orderBy(desc(documents.createdAt));
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
