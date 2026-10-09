import type { z } from "zod";
import type { ApiContext } from "@/lib/auth/api-context";
import { logFeedstockDelivery, updateFeedstock, deleteFeedstock } from "@/lib/operations/feedstocks";
import type { feedstockCreateEnvelopeSchema } from "@/lib/representations/envelopes";
import { representFeedstock } from "@/lib/representations/feedstocks";
import { ApiHttpError } from "./http-error";
import { API_FEEDSTOCK_MAX_ALLOCATIONS, FEEDSTOCK_REPRESENTATION_REVISION } from "@/config/api-rest";
import { readApiFeedstock } from "@/lib/read-models/api-feedstocks";
import { deadlineExceeded, DomainError } from "@/lib/domain-errors";
import type { Operation, OperationResult, OperationScope } from "@/lib/operations/runner";

export function remainingDeadlineMs(deadlineAt: number): number {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw deadlineExceeded("before starting");
  return remaining;
}

export function checkFeedstockAllocations(body: unknown) {
  if (body && typeof body === "object" && "allocations" in body &&
    Array.isArray(body.allocations) && body.allocations.length > API_FEEDSTOCK_MAX_ALLOCATIONS) {
    throw new DomainError("validation_failed", "Split this intake into smaller requests.", {
      issues: [{ path: ["allocations"], code: "too_big", message: "Too many bin allocations.", meta: { maximum: API_FEEDSTOCK_MAX_ALLOCATIONS } }],
    });
  }
}

/** Runs after the idempotency claim/replay, before any domain write. */
export async function checkRepresentation(scope: OperationScope, id: string, revision: number) {
  const row = await readApiFeedstock(scope.ctx, { id }, scope.tx);
  if (revision !== FEEDSTOCK_REPRESENTATION_REVISION) throw new DomainError("stale_version", "The representation has changed.");
  return row;
}

export function representationCheckedUpdate(id: string, revision: number): typeof updateFeedstock {
  return {
    ...updateFeedstock,
    execute: async (scope, input) => {
      await checkRepresentation(scope, id, revision);
      return updateFeedstock.execute(scope, input);
    },
  };
}

// DELETE has no surviving representation. A dry run returns the version
// that would be deleted; the operation still checks it while locked.
// Retain that row in stored outcomes so MCP can name a replayed deletion.
export function representationCheckedDelete(id: string, revision: number): Operation<typeof deleteFeedstock.input, Awaited<ReturnType<typeof readApiFeedstock>>> {
  return {
    ...deleteFeedstock,
    describe: (input) => deleteFeedstock.describe!(input, undefined),
    execute: async (scope, input) => {
      const row = await checkRepresentation(scope, id, revision);
      await deleteFeedstock.execute(scope, input);
      return row;
    },
  };
}

export async function withCurrentOnStale<T>(ctx: ApiContext, id: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof DomainError && error.code === "stale_version") {
      const current = await readApiFeedstock(ctx, { id });
      throw new ApiHttpError(412, "stale_version", "The feedstock has changed. Read the current representation before retrying.", current);
    }
    throw error;
  }
}

export function feedstockCreateBody(result: OperationResult<Awaited<ReturnType<typeof logFeedstockDelivery.execute>>>, dryRun: boolean) {
  const data = result.data.feedstocks.map(representFeedstock);
  return {
    data, ...(result.data.warning ? { warnings: [result.data.warning] } : {}),
    ...(dryRun ? { stockEffects: result.stockEffects } : {}),
  } satisfies z.infer<typeof feedstockCreateEnvelopeSchema>;
}
