import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { assertEmissionEntryDocumentWritable, bumpEmissionEntryEvidence, lockWritableEmissionEntry } from "./emission-entry-lock";
import { assertEmissionLineDocumentWritable, bumpEmissionLineFileEvidence } from "./emission-line-file-lock";
import { requireOrgScope } from "./utils";

export async function bumpDocumentOwnerEvidence(ctx: OrgContext, tx: DbTransaction, entityType: string, entityId: string) {
  requireOrgScope(ctx);
  if (entityType === "emission_entry") await bumpEmissionEntryEvidence(ctx, tx, entityType, entityId);
  if (entityType === "emission_line") await bumpEmissionLineFileEvidence(ctx, tx, entityType, entityId);
}

export async function assertDocumentOwnerEvidenceWritable(ctx: OrgContext, entityType: string, entityId: string, tx?: DbTransaction, entryOwnerLocked = false) {
  requireOrgScope(ctx);
  if (entityType === "emission_entry") {
    // The shared document scope already checked ownership and its archive policy.
    if (entryOwnerLocked && tx) await lockWritableEmissionEntry(ctx, tx, entityId);
    else await assertEmissionEntryDocumentWritable(ctx, entityId, tx);
  }
  if (entityType === "emission_line") await assertEmissionLineDocumentWritable(ctx, entityId, tx);
}
