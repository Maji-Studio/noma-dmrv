import { db } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { isRegistryMissingSubmission } from "@/lib/certification/registry-missing-submission";
import { ISOMETRIC_PROVIDER, REMOVAL_ENTITY_TYPE, REMOVAL_SUBMISSION_TYPE } from "@/lib/isometric/utils/constants";
import { getLatestSubmissionsForEntities, type Tx } from "./certification";
import { requireOrgScope } from "./utils";

/** Only the latest submitted version can reopen component files for Send again. */
export async function registryMissingComponentFileRemovalIds(ctx: OrgContext, removalIds: string[], executor: Tx | typeof db = db) {
  requireOrgScope(ctx);
  const latest = await getLatestSubmissionsForEntities(ctx, {
    provider: ISOMETRIC_PROVIDER, submissionType: REMOVAL_SUBMISSION_TYPE, localEntityType: REMOVAL_ENTITY_TYPE, localEntityIds: removalIds,
  }, undefined, executor, { submitted: "ledger" });
  return new Set([...latest].filter(([, row]) => isRegistryMissingSubmission(row)).map(([id]) => id));
}
