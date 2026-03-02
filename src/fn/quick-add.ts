/**
 * Quick Add Server Functions
 * Server actions for inline quick-add dialog entity creation
 */
"use server";

import {
  createDriver,
  createVehicle,
  createFeedstockType,
  type CreateDriverData,
  type CreateVehicleData,
  type CreateFeedstockTypeData,
} from "@/data-access/quick-add";
import { drivers, vehicles, feedstockTypes } from "@/db/schema";
import { generateNextCode } from "@/data-access/code-generator";
import {
  driverQuickAddSchema,
  vehicleQuickAddSchema,
  feedstockTypeQuickAddSchema,
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
  data: CreateDriverData
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

    const code = parsed.data.code || await generateNextCode("DRV", drivers, drivers.code);

    const driver = await createDriver({ ...parsed.data, code });
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
// Vehicle Quick Add
// ============================================

/**
 * Create a new vehicle from quick-add dialog
 */
export async function createVehicleFn(
  data: CreateVehicleData
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

    const code = parsed.data.code || await generateNextCode("VEH", vehicles, vehicles.code);

    const vehicle = await createVehicle({ ...parsed.data, code });
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
  data: CreateFeedstockTypeData
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

    const code = parsed.data.code || await generateNextCode("FT", feedstockTypes, feedstockTypes.code);

    const feedstockType = await createFeedstockType({ ...parsed.data, code });
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
