import { randomUUID } from "node:crypto";
import { readOutputStockBin, recordOutputStockMovementInTransaction, type RecordedOutputStockMovement } from "@/data-access/output-stock-post";
import { withOutputStockErrors } from "@/lib/output-stock-domain-errors";
import { STOCK_CONFLICT_ENTITY } from "@/lib/stock-conflict-entities";
import { recordOutputStockMovementInput } from "@/schemas/output-stock-movement-input";
import { resolveEventInstant } from "./event-times";
import type { OperationEffect } from "@/lib/operation-effect";
import type { Operation } from "./runner";

/**
 * Prefix of the movement request key generated when a caller sends none. A
 * fresh key per execution never double-posts: a retried attempt rolled back
 * the movement that used the previous one, and API replays are answered from
 * the runner's idempotency record before this runs.
 */
export const GENERATED_MOVEMENT_KEY_PREFIX = "api:";

/** Preconditions and the request key describe how a command was sent, not what it changed. */
const NOT_CHANGES: ReadonlySet<string> = new Set(["basisFingerprint", "expectedProductVersions", "idempotencyKey", "facilityId"]);

function changedFields(input: object): string[] {
  return Object.entries(input).filter(([key, value]) => value !== undefined && !NOT_CHANGES.has(key)).map(([key]) => key).sort();
}

/** The audit effect of a posted movement; adapters that publish a different output reuse it. */
export function describeRecordedMovement(input: object, movementId: string): OperationEffect {
  return {
    outcome: "created", entityType: STOCK_CONFLICT_ENTITY.binMovement, entityIds: [movementId],
    versionBefore: null, versionAfter: null, changedFields: changedFields(input),
  };
}

export const recordOutputStockMovement: Operation<typeof recordOutputStockMovementInput, RecordedOutputStockMovement> = {
  id: "record_output_stock_movement",
  input: recordOutputStockMovementInput,
  supportsDryRun: true,
  describe: (input, output) => describeRecordedMovement(input, output.movementId),
  execute: ({ ctx, tx, snapshotStock }, { idempotencyKey, occurredAt, facilityId, ...command }) => withOutputStockErrors(async () => {
    // The bin supplies the facility and the zone a facility-local time is read in.
    const bin = await readOutputStockBin(ctx, tx, { storageLocationId: command.storageLocationId, facilityId });
    return recordOutputStockMovementInTransaction(ctx, tx, {
      ...command,
      facilityId: bin.facilityId,
      occurredAt: resolveEventInstant(occurredAt, bin.timeZone, ["occurredAt"]).toISOString(),
      idempotencyKey: idempotencyKey ?? `${GENERATED_MOVEMENT_KEY_PREFIX}${randomUUID()}`,
    }, { snapshotStock });
  }, {
    // A short sub-bin points at its entry in `sources`; anything else at the mass.
    shortage: (detail) => {
      const index = detail.layerId ? command.sources?.findIndex((source) => source.layerId === detail.layerId) ?? -1 : -1;
      return index >= 0 ? ["sources", index] : ["wetMassKg"];
    },
  }),
};
