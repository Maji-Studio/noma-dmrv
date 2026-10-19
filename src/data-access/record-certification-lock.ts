import { applications, biocharProducts, creditBatches, deliveries, feedstocks, orders, productionRuns, samples } from "@/db/schema";
import { assertSameOrg } from "./utils";
import { db } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import type { DocumentEntityType } from "@/schemas/documents";
import { documentOwnerLineageTargets } from "./document-write-scope";
import { getRecordLocks, type CertifiedLineageTarget } from "./certification-lineage-guards";
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
    return (await getRecordLocks(ctx, tx, targets)).some(lock => lock.level === "sent");
  });
}

export async function getRecordLockForTarget(ctx: OrgContext, target: CertifiedLineageTarget) {
  requireOrgScope(ctx);
  return (await getRecordLocksForTargets(ctx, [target]))[0];
}

export async function getRecordLocksForTargets(ctx: OrgContext, targets: readonly CertifiedLineageTarget[]) {
  requireOrgScope(ctx);
  // Explicit existence and tenancy checks, without discarded lineage discovery.
  for (const target of targets) await assertSameOrg(ctx, TARGET_TABLES[target.entityType], target.entityId);
  return getRecordLocks(ctx, db, targets);
}

const TARGET_TABLES = { feedstock: feedstocks, productionRun: productionRuns, sample: samples,
  biocharProduct: biocharProducts, order: orders, delivery: deliveries, application: applications, creditBatch: creditBatches } as const;
