import { createProductionRunInput, updateProductionRunInput } from "@/schemas/production-run-input";
import { readRunFacilityTimeZone } from "@/data-access/production-run-input";
import { hasLocalRunInstant, resolveRunInstant } from "./production-run-times";
import {
  createProductionRunInTransaction, updateProductionRunInTransaction,
  deleteProductionRunInTransaction, type ProductionRunWithRelations,
} from "@/data-access/production-runs";
import { productionRuns } from "@/db/schema";
import { withAutoCodes, CODE_CONFLICT_MESSAGES } from "@/data-access/code-generator";
import { processPendingStorageObjectDeletions } from "@/data-access/storage-object-deletions";
import { deleteProductionRunSchema } from "@/schemas/production-runs";
import { withProductionRunErrors } from "@/lib/production-run-domain-errors";
import type { Operation } from "./runner";

const AUTO_CODE_COUNT = 1;

function changedFields(input: object): string[] {
  return Object.entries(input)
    .filter(([key, value]) => value !== undefined && key !== "expectedVersion" && key !== "productionRunId")
    .map(([key]) => key).sort();
}

export const startProductionRun: Operation<typeof createProductionRunInput, ProductionRunWithRelations> = {
  id: "start_production_run",
  input: createProductionRunInput,
  supportsDryRun: true,
  describe: (input, output) => ({
    outcome: "created", entityType: "productionRun", entityIds: [output.id],
    versionBefore: null, versionAfter: output.version, changedFields: changedFields(input),
  }),
  execute: async ({ ctx, tx, snapshotStock }, validated) => {
    const timeZone = hasLocalRunInstant(validated.startTime, validated.endTime)
      ? await readRunFacilityTimeZone(ctx, tx, validated) : undefined;
    return withProductionRunErrors(() => withAutoCodes(
      ctx, tx, "PR", productionRuns, productionRuns.code, AUTO_CODE_COUNT,
      ([code], savepoint) => createProductionRunInTransaction(ctx, savepoint, {
        code,
        facilityId: validated.facilityId,
        reactorId: validated.reactorId,
        status: validated.status,
        cancellationReason: validated.cancellationReason || null,
        startTime: resolveRunInstant(validated.startTime, timeZone, "startTime"),
        // An absent end time stores an open run.
        endTime: validated.endTime ? resolveRunInstant(validated.endTime, timeZone, "endTime") : null,
        operatorId: validated.operatorId || null,
        feedstockDraws: validated.feedstockDraws,
        feedstockMoisturePercent: validated.feedstockMoisturePercent ?? null,
        feedingRateKgHr: validated.feedingRateKgHr ?? null,
        residenceTimeMinutes: validated.residenceTimeMinutes ?? null,
        dieselOperationLiters: validated.dieselOperationLiters ?? null,
        dieselGensetLiters: validated.dieselGensetLiters ?? null,
        preprocessingFuelLiters: validated.preprocessingFuelLiters ?? null,
        electricityKwh: validated.electricityKwh ?? null,
        biocharOutputKg: validated.biocharOutputKg ?? null,
        biocharMoisturePercent: validated.biocharMoisturePercent ?? null,
        biocharStorageLocationId: validated.biocharStorageLocationId || null,
      }, { snapshotStock }),
      CODE_CONFLICT_MESSAGES.productionRun,
    ));
  },
};

export const updateProductionRun: Operation<typeof updateProductionRunInput, ProductionRunWithRelations> = {
  id: "update_production_run",
  input: updateProductionRunInput,
  supportsDryRun: true,
  describe: (input, output) => ({
    outcome: "updated", entityType: "productionRun", entityIds: [output.id],
    versionBefore: input.expectedVersion, versionAfter: output.version, changedFields: changedFields(input),
  }),
  execute: async ({ ctx, tx, snapshotStock }, validated) => {
    const timeZone = hasLocalRunInstant(validated.startTime, validated.endTime)
      ? await readRunFacilityTimeZone(ctx, tx, validated) : undefined;
    return withProductionRunErrors(() => updateProductionRunInTransaction(ctx, tx, validated.productionRunId, {
      code: validated.code,
      facilityId: validated.facilityId,
      reactorId: validated.reactorId,
      status: validated.status,
      expectedVersion: validated.expectedVersion,
      cancellationReason: validated.cancellationReason,
      startTime: validated.startTime === undefined ? undefined : resolveRunInstant(validated.startTime, timeZone, "startTime"),
      endTime: validated.endTime == null ? validated.endTime : resolveRunInstant(validated.endTime, timeZone, "endTime"),
      operatorId: validated.operatorId,
      feedstockDraws: validated.feedstockDraws,
      feedstockMoisturePercent: validated.feedstockMoisturePercent,
      feedingRateKgHr: validated.feedingRateKgHr,
      residenceTimeMinutes: validated.residenceTimeMinutes,
      dieselOperationLiters: validated.dieselOperationLiters,
      dieselGensetLiters: validated.dieselGensetLiters,
      preprocessingFuelLiters: validated.preprocessingFuelLiters,
      electricityKwh: validated.electricityKwh,
      biocharOutputKg: validated.biocharOutputKg,
      biocharMoisturePercent: validated.biocharMoisturePercent,
      biocharStorageLocationId: validated.biocharStorageLocationId,
    }, { snapshotStock }));
  },
};

export const deleteProductionRun: Operation<typeof deleteProductionRunSchema, void> = {
  id: "delete_production_run",
  input: deleteProductionRunSchema,
  supportsDryRun: true,
  describe: (input) => ({
    outcome: "deleted", entityType: "productionRun", entityIds: [input.productionRunId],
    versionBefore: input.expectedVersion, versionAfter: null, changedFields: [],
  }),
  execute: async ({ ctx, tx, afterCommit, snapshotStock }, { productionRunId, expectedVersion }) => {
    await withProductionRunErrors(() => deleteProductionRunInTransaction(ctx, tx, productionRunId, expectedVersion, snapshotStock));
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx); });
  },
};
