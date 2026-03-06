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
} from "@/data-access/quick-add";
import { drivers, vehicles, feedstockTypes } from "@/db/schema";
import { withAutoCode } from "@/data-access/code-generator";
import {
  driverQuickAddSchema,
  operatorQuickAddSchema,
  vehicleQuickAddSchema,
  feedstockTypeQuickAddSchema,
  type DriverQuickAddData,
  type OperatorQuickAddData,
  type VehicleQuickAddData,
  type FeedstockTypeQuickAddData,
} from "@/schemas/quick-add";
import type { EntityOption } from "@/components/forms/entity-select/types";
import { getUser } from "@/lib/auth/server";
import type { ActionResult } from "@/types/actions";

// ============================================
// Driver Quick Add
// ============================================

/**
 * Create a new driver from quick-add dialog
 */
export async function createDriverFn(
  data: DriverQuickAddData
): Promise<ActionResult<EntityOption>> {
  try {
    const user = await getUser();
    if (!user || !user.id) {
      return { success: false, error: "Unauthorized" };
    }

    // Validate input
    const parsed = driverQuickAddSchema.safeParse(data);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }

    const driver = await withAutoCode(
      "DRV", drivers, drivers.code, undefined,
      (code) => createDriver({ ...parsed.data, code })
    );
    return { success: true, data: driver };
  } catch (error) {
    console.error("Error creating driver:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create driver",
    };
  }
}

// ============================================
// Operator Quick Add
// ============================================

export async function createOperatorFn(
  data: OperatorQuickAddData
): Promise<ActionResult<EntityOption>> {
  try {
    const user = await getUser();
    if (!user || !user.id) {
      return { success: false, error: "Unauthorized" };
    }

    const parsed = operatorQuickAddSchema.safeParse(data);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }

    const operator = await createOperator(parsed.data);
    return { success: true, data: operator };
  } catch (error) {
    console.error("Error creating operator:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create operator",
    };
  }
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
  try {
    const user = await getUser();
    if (!user || !user.id) {
      return { success: false, error: "Unauthorized" };
    }

    // Validate input
    const parsed = vehicleQuickAddSchema.safeParse(data);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }

    const vehicle = await withAutoCode(
      "VEH", vehicles, vehicles.code, undefined,
      (code) => createVehicle({ ...parsed.data, code })
    );
    return { success: true, data: vehicle };
  } catch (error) {
    console.error("Error creating vehicle:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create vehicle",
    };
  }
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
  try {
    const user = await getUser();
    if (!user || !user.id) {
      return { success: false, error: "Unauthorized" };
    }

    // Validate input
    const parsed = feedstockTypeQuickAddSchema.safeParse(data);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }

    const feedstockType = await withAutoCode(
      "FT", feedstockTypes, feedstockTypes.code, undefined,
      (code) => createFeedstockType({ ...parsed.data, code })
    );
    return { success: true, data: feedstockType };
  } catch (error) {
    console.error("Error creating feedstock type:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to create feedstock type",
    };
  }
}
