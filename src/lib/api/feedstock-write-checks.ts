import { API_FEEDSTOCK_MAX_ALLOCATIONS, FEEDSTOCK_REPRESENTATION_REVISION } from "@/config/api-rest";
import { readApiFeedstock } from "@/lib/read-models/api-feedstocks";
import { deadlineExceeded, DomainError } from "@/lib/domain-errors";
import type { OperationScope } from "@/lib/operations/runner";

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

