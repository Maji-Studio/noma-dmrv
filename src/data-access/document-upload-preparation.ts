import { db } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import type { DocumentRow } from "./documents";
import { inspectDocumentOwner } from "./document-write-scope";
import { requireOrgScope } from "./utils";

/** Unlocked owner discovery before external upload inspection. */
export async function inspectUploadOwner(ctx: OrgContext, row: DocumentRow) {
  requireOrgScope(ctx);
  return db.transaction((tx) => inspectDocumentOwner(ctx, tx, row.entityType, row.entityId));
}
