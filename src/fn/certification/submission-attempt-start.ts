import { markSubmissionAttemptStarted } from "@/data-access/certification-submissions";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";

/** Keep the durable crash marker separate from the attempt's observed mutations. */
export async function startSubmissionRegistryAttempt(
  ctx: OrgContext,
  row: { id: string; lockedAt: Date | null },
): Promise<void> {
  if (!row.lockedAt || !(await markSubmissionAttemptStarted(ctx, row.id, row.lockedAt))) {
    throw new SafeError(
      "The submission lock changed before sending to Isometric. Reload and retry.",
    );
  }
}
