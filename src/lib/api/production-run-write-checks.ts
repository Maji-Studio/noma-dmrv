import type { ApiContext } from "@/lib/auth/api-context";
import { startProductionRun, updateProductionRun, deleteProductionRun } from "@/lib/operations/production-runs";
import { ApiHttpError } from "./http-error";
import { API_PRODUCTION_RUN_MAX_DRAWS, PRODUCTION_RUN_REPRESENTATION_REVISION } from "@/config/api-rest";
import { readApiProductionRun } from "@/lib/read-models/api-production-runs";
import { DomainError } from "@/lib/domain-errors";
import type { Operation, OperationResult, OperationScope } from "@/lib/operations/runner";
import type { ProductionRunRepresentation } from "@/lib/representations/production-runs";

export function checkProductionRunDraws(body: unknown) {
  if (body && typeof body === "object" && "feedstockDraws" in body && Array.isArray(body.feedstockDraws) && body.feedstockDraws.length > API_PRODUCTION_RUN_MAX_DRAWS) {
    throw new DomainError("validation_failed", "Split this run into smaller requests.", {
      issues: [{ path: ["feedstockDraws"], code: "too_big", message: "Too many feedstock draws.", meta: { maximum: API_PRODUCTION_RUN_MAX_DRAWS } }],
    });
  }
}

/** Enrich inside the runner transaction so saved and replayed outcomes have the same facility clock. */
export const representationCheckedStart: Operation<typeof startProductionRun.input, ProductionRunRepresentation> = {
  ...startProductionRun,
  describe: (input, output) => ({ outcome: "created", entityType: "productionRun", entityIds: [output.id], versionBefore: null, versionAfter: output.version, changedFields: Object.keys(input).filter((key) => input[key as keyof typeof input] !== undefined).sort() }),
  execute: async (scope, input) => {
    const run = await startProductionRun.execute(scope, input);
    return readApiProductionRun(scope.ctx, { id: run.id }, scope.tx);
  },
};

async function checkRepresentation(scope: OperationScope, id: string, revision: number) {
  const row = await readApiProductionRun(scope.ctx, { id }, scope.tx);
  if (revision !== PRODUCTION_RUN_REPRESENTATION_REVISION) throw new DomainError("stale_version", "The representation has changed.");
  return row;
}

export function representationCheckedUpdate(id: string, revision: number): Operation<typeof updateProductionRun.input, ProductionRunRepresentation> {
  return {
    ...updateProductionRun,
    describe: (input, output) => ({ outcome: "updated", entityType: "productionRun", entityIds: [output.id], versionBefore: input.expectedVersion, versionAfter: output.version, changedFields: Object.keys(input).filter((key) => key !== "expectedVersion" && key !== "productionRunId" && input[key as keyof typeof input] !== undefined).sort() }),
    execute: async (scope, input) => {
      await checkRepresentation(scope, id, revision);
      await updateProductionRun.execute(scope, input);
      return readApiProductionRun(scope.ctx, { id }, scope.tx);
    },
  };
}

/** Retain the deleted row in transport-neutral outcomes so MCP can name REST replays. */
export function representationCheckedDelete(id: string, revision: number): Operation<typeof deleteProductionRun.input, ProductionRunRepresentation> {
  return {
    ...deleteProductionRun,
    describe: (input) => deleteProductionRun.describe!(input, undefined),
    execute: async (scope, input) => {
      const row = await checkRepresentation(scope, id, revision);
      await deleteProductionRun.execute(scope, input);
      return row;
    },
  };
}

export async function withCurrentOnStale<T>(ctx: ApiContext, id: string, fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (error) {
    if (error instanceof DomainError && error.code === "stale_version") {
      const current = await readApiProductionRun(ctx, { id });
      throw new ApiHttpError(412, "stale_version", "The production run has changed. Read the current representation before retrying.", current);
    }
    throw error;
  }
}

export function productionRunBody(result: OperationResult<ProductionRunRepresentation>, dryRun: boolean) {
  return { data: result.data, ...(dryRun ? { stockEffects: result.stockEffects } : {}) };
}
