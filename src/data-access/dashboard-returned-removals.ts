/**
 * Which of the given Removals the verifier sent back, for the dashboard's
 * Needs attention (#1532). Display only, from persisted lineage: the same
 * Returned rule (`readsAsReturnedFromPersisted`) the batch to-dos'
 * missing-runs read and the record locks use. Never authorizes an edit; that
 * still needs a fresh read under locks. The caller passes the Removals its
 * attention query already read, so this costs only the lineage read.
 */
import { db } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { readsAsReturnedFromPersisted } from "@/lib/record-lock";
import { readRecordLockLineage } from "./record-lock-lineage";
import { requireOrgScope } from "./utils";

export async function loadReturnedRemovalIds(
  ctx: OrgContext,
  removals: readonly { removalId: string; ghgStatementId: string | null }[],
): Promise<Set<string>> {
  requireOrgScope(ctx);
  if (!removals.length) return new Set();
  const facts = await readRecordLockLineage(ctx, db, removals);
  return new Set(facts.filter(readsAsReturnedFromPersisted).map((fact) => fact.id));
}
