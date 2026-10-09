import {
  createProductionRunInTransaction, updateProductionRunInTransaction,
  deleteProductionRunInTransaction, type ProductionRunWithRelations,
} from "@/data-access/production-runs";
import { productionRuns } from "@/db/schema";
import { withAutoCodes, CODE_CONFLICT_MESSAGES } from "@/data-access/code-generator";
import { processPendingStorageObjectDeletions } from "@/data-access/storage-object-deletions";
import { createProductionRunSchema, updateProductionRunSchema, deleteProductionRunSchema } from "@/schemas/production-runs";
import { withProductionRunErrors } from "@/lib/production-run-domain-errors";
import type { Operation } from "./runner";

const AUTO_CODE_COUNT = 1;

function changedFields(input: object): string[] {
  return Object.entries(input)
    .filter(([key, value]) => value !== undefined && key !== "expectedVersion" && key !== "productionRunId")
    .map(([key]) => key).sort();
}

export const startProductionRun: Operation<typeof createProductionRunSchema, ProductionRunWithRelations> = {
  id: "start_production_run",
  input: createProductionRunSchema,
  supportsDryRun: true,
  describe: (input, output) => ({
    outcome: "created", entityType: "productionRun", entityIds: [output.id],
    versionBefore: null, versionAfter: output.version, changedFields: changedFields(input),
  }),
  execute: ({ ctx, tx }, validated) => withProductionRunErrors(() => withAutoCodes(
    ctx, tx, "PR", productionRuns, productionRuns.code, AUTO_CODE_COUNT,
    ([code], savepoint) => createProductionRunInTransaction(ctx, savepoint, {
      code,
      facilityId: validated.facilityId,
      reactorId: validated.reactorId,
      status: validated.status,
      cancellationReason: validated.cancellationReason || null,
      startTime: validated.startTime instanceof Date ? validated.startTime : new Date(validated.startTime),
      // An absent end time stores an open run.
      endTime: validated.endTime instanceof Date ? validated.endTime : null,
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
    }),
    CODE_CONFLICT_MESSAGES.productionRun,
  )),
};

export const updateProductionRun: Operation<typeof updateProductionRunSchema, ProductionRunWithRelations> = {
  id: "update_production_run",
  input: updateProductionRunSchema,
  supportsDryRun: true,
  describe: (input, output) => ({
    outcome: "updated", entityType: "productionRun", entityIds: [output.id],
    versionBefore: input.expectedVersion, versionAfter: output.version, changedFields: changedFields(input),
  }),
  execute: ({ ctx, tx }, validated) => withProductionRunErrors(() => updateProductionRunInTransaction(ctx, tx, validated.productionRunId, {
    code: validated.code,
    facilityId: validated.facilityId,
    reactorId: validated.reactorId,
    status: validated.status,
    expectedVersion: validated.expectedVersion,
    cancellationReason: validated.cancellationReason,
    startTime: validated.startTime instanceof Date ? validated.startTime : validated.startTime ? new Date(validated.startTime) : undefined,
    // null clears the end time; undefined leaves it unchanged.
    endTime:
      validated.endTime === null
        ? null
        : validated.endTime instanceof Date
          ? validated.endTime
          : validated.endTime
            ? new Date(validated.endTime)
            : undefined,
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
  })),
};

export const deleteProductionRun: Operation<typeof deleteProductionRunSchema, void> = {
  id: "delete_production_run",
  input: deleteProductionRunSchema,
  supportsDryRun: true,
  describe: (input) => ({
    outcome: "deleted", entityType: "productionRun", entityIds: [input.productionRunId],
    versionBefore: input.expectedVersion, versionAfter: null, changedFields: [],
  }),
  execute: async ({ ctx, tx, afterCommit }, { productionRunId, expectedVersion }) => {
    await withProductionRunErrors(() => deleteProductionRunInTransaction(ctx, tx, productionRunId, expectedVersion));
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx); });
  },
};
