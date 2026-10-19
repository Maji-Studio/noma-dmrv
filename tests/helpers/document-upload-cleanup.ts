import { and, eq, like, or } from "drizzle-orm";
import { db } from "@/db";
import { documents, storageObjectDeletions } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
/** A test's known document ids, including rows already deleted by its writer. */
export async function cleanupDocumentUploads(ctx: OrgContext, ids: string[]) {
  for (const id of ids) {
    await db.delete(storageObjectDeletions).where(and(eq(storageObjectDeletions.organizationId, ctx.organizationId), or(like(storageObjectDeletions.storageKey, `%/${id}/%`), like(storageObjectDeletions.storageKey, `%/${id}-%`))));
    await db.delete(documents).where(and(eq(documents.organizationId, ctx.organizationId), eq(documents.id, id)));
  }
}
