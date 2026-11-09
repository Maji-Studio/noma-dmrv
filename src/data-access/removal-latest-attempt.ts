import type { OrgContext } from "@/lib/auth/server";
import { deriveSubmissionAttempts } from "@/lib/certification/submission-attempts";
import { listRemovalAttemptEvents } from "./certifier-sync-events";
import { requireOrgScope } from "./utils";

/** Read the latest outcome through the organization-scoped attempt history. */
export async function isLatestRemovalAttemptChanged(ctx: OrgContext, removalId: string): Promise<boolean> {
  requireOrgScope(ctx);
  const events = await listRemovalAttemptEvents(ctx, { removalId });
  return deriveSubmissionAttempts(events)[0]?.outcome.kind === "changed";
}
