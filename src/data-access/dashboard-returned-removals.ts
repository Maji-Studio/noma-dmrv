/**
 * Which Removals holding the given credit batches the verifier sent back,
 * for the dashboard's Needs attention (#1532). Display only, from persisted
 * lineage: the same Returned rule (`readsAsReturnedFromPersisted`) the batch
 * to-dos' missing-runs read and the record locks use. Never authorizes an
 * edit; that still needs a fresh read under locks.
 */
import { db } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { readsAsReturnedFromPersisted } from "@/lib/record-lock";
import { listCreditBatchCertificationLinks } from "./credit-batch-certification-links";
import { readRecordLockLineage } from "./record-lock-lineage";
import { requireOrgScope } from "./utils";

export async function loadReturnedRemovalIds(
  ctx: OrgContext,
  creditBatchIds: readonly string[],
): Promise<Set<string>> {
  requireOrgScope(ctx);
  if (!creditBatchIds.length) return new Set();
  const links = await listCreditBatchCertificationLinks(ctx, [...creditBatchIds]);
  const facts = await readRecordLockLineage(ctx, db, links.flatMap((link) => link.removalId
    ? [{ removalId: link.removalId, ghgStatementId: link.ghgStatementId }] : []));
  return new Set(facts.filter(readsAsReturnedFromPersisted).map((fact) => fact.id));
}
