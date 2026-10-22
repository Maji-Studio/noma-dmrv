import type { EntryContender } from "@/lib/certification/removal-emission-contributions";
import { getEffectiveReportingPeriodEndOn } from "./certifier-ghg-statements";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { certificationSubmissions, certifierRemovals, certifierGhgStatements } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";
import { listEmissionEntryDraftContenders } from "./emission-entry-contenders";
import { getLatestTemplateObservation } from "./removal-template-observations";
import { getCreditBatchesByRemovalId } from "./certifier-removals";

/** Advisory state only. Mutation authorization comes from the locked lineage loader. */
export async function loadRemovalCorrectionFacts(ctx: OrgContext, removalId: string, suppliedContenders?: EntryContender[]) {
  requireOrgScope(ctx);
  const [submitted] = await db.select().from(certificationSubmissions).where(and(
    eq(certificationSubmissions.organizationId, ctx.organizationId), eq(certificationSubmissions.localEntityType, "removal"),
    eq(certificationSubmissions.submissionType, "removal"), eq(certificationSubmissions.provider, "isometric"),
    eq(certificationSubmissions.localEntityId, removalId), isNotNull(certificationSubmissions.submittedAt),
  )).orderBy(desc(certificationSubmissions.version)).limit(1);
  if (!submitted) return null;
  const batches = await getCreditBatchesByRemovalId(ctx, removalId);
  const ids = batches.map((batch) => batch.id);
  const contenders = suppliedContenders ?? await listEmissionEntryDraftContenders(ctx, ids, undefined, undefined, true);
  const correction = contenders.find((item) => item.removalId === removalId && item.contenderKind === "correction");
  if (!correction) return null;
  const pin = batches[0]?.removalTemplateId;
  const observation = pin ? await getLatestTemplateObservation(ctx, "isometric", pin) : null;
  if (!correction.returnedStatement) return null;
  const [identity] = await db.select({ code: certifierRemovals.code,
    reportingPeriodStartOn: certifierGhgStatements.reportingPeriodStartOn,
    reportingPeriodEndOn: certifierGhgStatements.reportingPeriodEndOn,
    metadata: certifierGhgStatements.metadata,
  }).from(certifierRemovals)
    .innerJoin(certifierGhgStatements, and(eq(certifierGhgStatements.organizationId, ctx.organizationId),
      eq(certifierGhgStatements.id, correction.returnedStatement.id)))
    .where(and(eq(certifierRemovals.organizationId, ctx.organizationId), eq(certifierRemovals.id, removalId)));
  if (!identity) return null;
  return { submitted, batches, contenders, correction, observation, identity: {
    ...identity, reportingPeriodEndOn: getEffectiveReportingPeriodEndOn(identity),
  } };
}

/** Evidence follows live attachments only under the existing lineage predicate. */
export async function removalCorrectionWindowOpen(ctx: OrgContext, removalId: string): Promise<boolean> {
  requireOrgScope(ctx);
  const batches = await getCreditBatchesByRemovalId(ctx, removalId);
  const contenders = await listEmissionEntryDraftContenders(ctx, batches.map(batch => batch.id), undefined, undefined, true);
  return contenders.some(item => item.removalId === removalId && item.contenderKind === "correction");
}

export async function listStatementRemovalIdentities(ctx: OrgContext, statementId: string) {
  requireOrgScope(ctx);
  return db.select({ id: certifierRemovals.id, code: certifierRemovals.code }).from(certifierRemovals).where(and(
    eq(certifierRemovals.organizationId, ctx.organizationId), eq(certifierRemovals.ghgStatementId, statementId),
  ));
}
