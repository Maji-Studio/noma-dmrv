/**
 * Quick Add Server Functions
 * Server actions for inline quick-add dialog entity creation
 */
"use server";

import {
  createDriver,
  createOperator,
  createVehicle,
  createFeedstockType,
  createStorageLocation,
} from "@/data-access/quick-add";
import { drivers, vehicles, feedstockTypes, storageLocations } from "@/db/schema";
import { withAutoCode } from "@/data-access/code-generator";
import {
  driverQuickAddSchema,
  operatorQuickAddSchema,
  vehicleQuickAddSchema,
  feedstockTypeQuickAddSchema,
  storageLocationQuickAddSchema,
  type DriverQuickAddData,
  type OperatorQuickAddData,
  type VehicleQuickAddData,
  type FeedstockTypeQuickAddData,
  type StorageLocationQuickAddData,
} from "@/schemas/quick-add";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

// ============================================
// Driver Quick Add
// ============================================

/**
 * Create a new driver from quick-add dialog
 */
export async function createDriverFn(
  data: DriverQuickAddData
): Promise<ActionResult<EntityOption>> {
  return withAction(async (ctx) => {
    const parsed = driverQuickAddSchema.parse(data);
    return withAutoCode(
      ctx,
      "DRV", drivers, drivers.code, undefined,
      (code) => createDriver(ctx, { ...parsed, code })
    );
  }, { fallbackMessage: "Failed to create driver" });
}

// ============================================
// Operator Quick Add
// ============================================

export async function createOperatorFn(
  data: OperatorQuickAddData
): Promise<ActionResult<EntityOption>> {
  return withAction(async (ctx) => {
    const parsed = operatorQuickAddSchema.parse(data);
    return createOperator(ctx, parsed);
  }, { fallbackMessage: "Failed to create operator" });
}

// ============================================
// Vehicle Quick Add
// ============================================

/**
 * Create a new vehicle from quick-add dialog
 */
export async function createVehicleFn(
  data: VehicleQuickAddData
): Promise<ActionResult<EntityOption>> {
  return withAction(async (ctx) => {
    const parsed = vehicleQuickAddSchema.parse(data);
    return withAutoCode(
      ctx,
      "VEH", vehicles, vehicles.code, undefined,
      (code) => createVehicle(ctx, { ...parsed, code })
    );
  }, { fallbackMessage: "Failed to create vehicle" });
}

// ============================================
// Feedstock Type Quick Add
// ============================================

/**
 * Create a new feedstock type from quick-add dialog
 */
export async function createFeedstockTypeFn(
  data: FeedstockTypeQuickAddData
): Promise<ActionResult<EntityOption>> {
  return withAction(async (ctx) => {
    const parsed = feedstockTypeQuickAddSchema.parse(data);
    return withAutoCode(
      ctx,
      "FT", feedstockTypes, feedstockTypes.code, undefined,
      (code) => createFeedstockType(ctx, { ...parsed, code })
    );
  }, { fallbackMessage: "Failed to create feedstock type" });
}

// ============================================
// Storage Location Quick Add
// ============================================

/**
 * Create a new storage location from quick-add dialog
 */
export async function createStorageLocationFn(
  data: StorageLocationQuickAddData
): Promise<ActionResult<EntityOption>> {
  return withAction(async (ctx) => {
    const parsed = storageLocationQuickAddSchema.parse(data);

    const prefixMap: Record<string, string> = {
      feedstock_bin: "FB",
      biochar_bin: "BB",
      product_bin: "PB",
    };
    const prefix = prefixMap[parsed.type] ?? "PB";

    return withAutoCode(
      ctx,
      prefix, storageLocations, storageLocations.code, undefined,
      (code) => createStorageLocation(ctx, { ...parsed, code })
    );
  }, { fallbackMessage: "Failed to create storage location" });
}
