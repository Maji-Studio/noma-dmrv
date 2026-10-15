import { db } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import type { DocumentEntityType } from "@/schemas/documents";
import { getCertifiedLineage, isSubmittedLineageRow } from "./certification-lineage-guards";
import { documentOwnerLineageTargets } from "./document-write-scope";
import { requireOrgScope } from "./utils";

export interface RecordCertificationLockInput {
  entityType: DocumentEntityType;
  entityId: string;
}

/**
 * Advisory read for the UI: true once the record's lineage holds a submitted
 * Removal or GHG statement. It maps the owner exactly as the document writers
 * do, so a panel shown read-only matches the `certification_locked` refusal.
 * Owners without lineage (facility, reactor) answer false; a record outside
 * the org is refused with not_found.
 */
export async function getRecordCertificationLock(ctx: OrgContext, input: RecordCertificationLockInput): Promise<boolean> {
  requireOrgScope(ctx);
  return db.transaction(async (tx) => {
    const targets = await documentOwnerLineageTargets(ctx, tx, input.entityType, input.entityId);
    for (const target of targets) {
      if ((await getCertifiedLineage(ctx, tx, target)).some(isSubmittedLineageRow)) return true;
    }
    return false;
  });
}
