import { CODE_CONFLICT_MESSAGES, withAutoCodes } from "@/data-access/code-generator";
import { createStorageLocationInTransaction } from "@/data-access/storage-locations";
import { storageLocations, type StorageLocation } from "@/db/schema";
import { createStorageLocationSchema } from "@/schemas/storage-locations";
import type { Operation } from "./runner";

const AUTO_CODE_COUNT = 1;

// The sheet accepts storage method/description and generates SL codes. Quick-add
// has a smaller input, different normalization and FB/BB/PB codes, so it stays separate.
export const createStorageLocation: Operation<typeof createStorageLocationSchema, StorageLocation> = {
  id: "create_storage_location",
  input: createStorageLocationSchema,
  supportsDryRun: false,
  execute: ({ ctx, tx }, input) => withAutoCodes(
    ctx, tx, "SL", storageLocations, storageLocations.code, AUTO_CODE_COUNT,
    ([code], savepoint) => createStorageLocationInTransaction(ctx, savepoint, {
      code,
      name: input.name,
      type: input.type,
      facilityId: input.facilityId,
      capacityKg: input.capacityKg ?? null,
      feedstockTypeId: input.feedstockTypeId ?? null,
      formulationId: input.formulationId ?? null,
      stockMode: input.stockMode,
      drawOrder: input.drawOrder,
      storageMethod: input.storageMethod || null,
      storageDescription: input.storageDescription || null,
    }),
    CODE_CONFLICT_MESSAGES.storageLocation,
  ),
};
