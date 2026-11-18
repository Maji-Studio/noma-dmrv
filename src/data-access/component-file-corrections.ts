import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { certificationSubmissions } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { isRegistryMissingSubmission } from "@/lib/certification/registry-missing-submission";
import { requireOrgScope, type Executor } from "./utils";

/** Only the latest submitted version can reopen component files for Send again. */
export async function registryMissingComponentFileRemovalIds(ctx: OrgContext, executor: Executor, removalIds: string[]) {
  requireOrgScope(ctx);
  if (!removalIds.length) return new Set<string>();
  const sent = await executor.select().from(certificationSubmissions).where(and(
    eq(certificationSubmissions.organizationId, ctx.organizationId), eq(certificationSubmissions.provider, "isometric"),
    eq(certificationSubmissions.localEntityType, "removal"), eq(certificationSubmissions.submissionType, "removal"),
    inArray(certificationSubmissions.localEntityId, removalIds), isNotNull(certificationSubmissions.submittedAt),
  )).orderBy(desc(certificationSubmissions.version));
  const seen = new Set<string>();
  const missing = new Set<string>();
  for (const row of sent) {
    if (seen.has(row.localEntityId)) continue;
    seen.add(row.localEntityId);
    if (isRegistryMissingSubmission(row)) missing.add(row.localEntityId);
  }
  return missing;
}
