import type { z } from "zod";
import { OPERATION_DEADLINE_MS } from "@/config/operations";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError, type CascadePreview } from "@/lib/domain-errors";
import { logApiError, shouldLogDomainError } from "@/lib/api/route-error";
import { runOperation, type Operation, type RunOptions } from "./runner";

/**
 * After rollback, preview the current cascade in a fresh transaction. Like the
 * stock-basis fallback, this has no idempotency key or audit and shares the
 * original deadline. Failure to preview leaves the original refusal intact.
 */
export async function runWithCascadePreview<Input extends z.ZodType, Output extends { cascade: CascadePreview }>(
  operation: Operation<Input, Output>, ctx: OrgContext, input: unknown, options: RunOptions = {},
) {
  const deadlineAt = Date.now() + (options.deadlineMs ?? OPERATION_DEADLINE_MS);
  try {
    return await runOperation(operation, ctx, input, options);
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== "cascade_changed") throw error;
    const deadlineMs = deadlineAt - Date.now();
    if (deadlineMs <= 0) throw error;
    const freshInput = { ...(input as Record<string, unknown>) };
    delete freshInput.cascadeFingerprint;
    let preview: CascadePreview | undefined;
    try {
      const fresh = await runOperation(operation, ctx, freshInput, { pool: options.pool, dryRun: true, deadlineMs });
      preview = fresh.data.cascade;
    } catch (previewError) {
      if (!(previewError instanceof DomainError) || shouldLogDomainError(previewError)) {
        logApiError(previewError, operation.id, options.audit?.requestId ?? operation.id);
      }
    }
    if (!preview) throw error;
    throw new DomainError("cascade_changed", error.message, { issues: error.issues, preview });
  }
}
