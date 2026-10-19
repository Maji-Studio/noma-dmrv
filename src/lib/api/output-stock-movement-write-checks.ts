import { describeRecordedMovement, recordOutputStockMovement } from "@/lib/operations/output-stock";
import type { Operation, OperationResult } from "@/lib/operations/runner";
import { readApiOutputStockMovement } from "@/lib/read-models/api-output-stock-movements";
import { outputStockMovementRepresentationSchema, type OutputStockMovementRepresentation } from "@/lib/representations/output-stock-movements";
import { recordOutputStockMovementApiInput } from "@/schemas/output-stock-movement-input";

/** A posted movement as published, with the stock basis it was posted on. */
export interface RecordedMovementOutput {
  movement: OutputStockMovementRepresentation;
  basisFingerprint: string;
}

/**
 * Record the movement and read its public projection inside the write
 * transaction. The bin comes from the path; a missing, archived or foreign bin
 * answers 404 and a feedstock bin 422, both on `/storageLocationId`, from the
 * posting seam's own bin read. The input is the published body only: losses
 * and counts, no correction, no UI fields.
 */
export const representationCheckedRecord: Operation<typeof recordOutputStockMovementApiInput, RecordedMovementOutput> = {
  id: recordOutputStockMovement.id,
  input: recordOutputStockMovementApiInput,
  supportsDryRun: true,
  describe: (input, output) => describeRecordedMovement(input, output.movement.id),
  execute: async (scope, input) => {
    const recorded = await recordOutputStockMovement.execute(scope, input);
    return {
      movement: await readApiOutputStockMovement(scope.ctx, recorded.movementId, scope.tx),
      basisFingerprint: recorded.basisFingerprint,
    };
  },
};

export function recordedMovementBody(result: OperationResult<RecordedMovementOutput>, dryRun: boolean) {
  return {
    // Replays come back from JSON storage with keys reordered; the schema restores the published order.
    data: outputStockMovementRepresentationSchema.parse(result.data.movement),
    ...(dryRun ? { stockEffects: result.stockEffects, basisFingerprint: result.data.basisFingerprint } : {}),
  };
}
