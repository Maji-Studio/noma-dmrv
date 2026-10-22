import { CODE_CONFLICT_MESSAGES, withAutoCodes } from "@/data-access/code-generator";
import { vehicles, storageLocations } from "@/db/schema";
import { createVehicleInTransaction, createStorageLocationInTransaction } from "@/data-access/quick-add";
import type { EntityOption } from "@/components/forms/entity-select/types";
import { vehicleQuickAddSchema, storageLocationQuickAddSchema } from "@/schemas/quick-add";
import type { Operation } from "./runner";

const AUTO_CODE_COUNT = 1;
const BIN_PREFIXES: Record<string, string> = { feedstock_bin: "FB", biochar_bin: "BB", product_bin: "PB" };

export const createVehicle: Operation<typeof vehicleQuickAddSchema, EntityOption> = {
  id: "create_vehicle",
  input: vehicleQuickAddSchema,
  supportsDryRun: false,
  execute: ({ ctx, tx }, input) => withAutoCodes(ctx, tx, "VEH", vehicles, vehicles.code, AUTO_CODE_COUNT,
    ([code], savepoint) => createVehicleInTransaction(ctx, savepoint, { ...input, code }), CODE_CONFLICT_MESSAGES.vehicle),
};

// Quick-add omits storageMethod/storageDescription and returns an enriched option.
// The settings create (#1302) has a different input and normalization contract.
export const createQuickStorageLocation: Operation<typeof storageLocationQuickAddSchema, EntityOption> = {
  id: "create_quick_storage_location",
  input: storageLocationQuickAddSchema,
  supportsDryRun: false,
  execute: ({ ctx, tx }, input) => withAutoCodes(ctx, tx, BIN_PREFIXES[input.type] ?? "PB", storageLocations, storageLocations.code, AUTO_CODE_COUNT,
    ([code], savepoint) => createStorageLocationInTransaction(ctx, savepoint, { ...input, code }), CODE_CONFLICT_MESSAGES.storageLocation),
};
