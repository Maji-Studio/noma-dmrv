/**
 * Quick Add Server Functions
 * Server actions for inline quick-add dialog entity creation
 */
"use server";

import { createDriver } from "@/lib/operations/drivers";
import { createOperator } from "@/lib/operations/operators";
import type { CreateIntentOptions } from "@/schemas/create-intent";
import { createVehicle, createQuickStorageLocation } from "@/lib/operations/quick-add";
import { createFeedstockType } from "@/lib/operations/feedstock-types";
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
import { withCreate } from "./with-create";

// ============================================
// Driver Quick Add
// ============================================

/**
 * Create a new driver from quick-add dialog
 */
export async function createDriverFn(
  data: DriverQuickAddData,
  options?: CreateIntentOptions,
): Promise<ActionResult<EntityOption>> {
  return withCreate(async (_ctx, create) => {
    const parsed = driverQuickAddSchema.parse(data);
    return create(createDriver, parsed);
  }, options, { fallbackMessage: "Failed to create driver" });
}

// ============================================
// Operator Quick Add
// ============================================

export async function createOperatorFn(
  data: OperatorQuickAddData,
  options?: CreateIntentOptions,
): Promise<ActionResult<EntityOption>> {
  return withCreate(async (_ctx, create) => {
    const parsed = operatorQuickAddSchema.parse(data);
    return create(createOperator, parsed);
  }, options, { fallbackMessage: "Failed to create operator" });
}

// ============================================
// Vehicle Quick Add
// ============================================

/**
 * Create a new vehicle from quick-add dialog
 */
export async function createVehicleFn(
  data: VehicleQuickAddData,
  options?: CreateIntentOptions,
): Promise<ActionResult<EntityOption>> {
  return withCreate((_ctx, create) => create(createVehicle, vehicleQuickAddSchema.parse(data)), options,
    { fallbackMessage: "Failed to create vehicle" });
}

export async function createFeedstockTypeFn(
  data: FeedstockTypeQuickAddData,
  options?: CreateIntentOptions,
): Promise<ActionResult<EntityOption>> {
  return withCreate(async (_ctx, create) => {
    const result = await create(createFeedstockType, feedstockTypeQuickAddSchema.parse(data));
    return { id: result.id, code: result.code, name: result.name, subtitle: `${result.category} · ${result.usage}` };
  }, options, { fallbackMessage: "Failed to create feedstock type" });
}

export async function createStorageLocationFn(
  data: StorageLocationQuickAddData,
  options?: CreateIntentOptions,
): Promise<ActionResult<EntityOption>> {
  return withCreate((_ctx, create) => create(createQuickStorageLocation, storageLocationQuickAddSchema.parse(data)), options,
    { fallbackMessage: "Failed to create storage bin" });
}
