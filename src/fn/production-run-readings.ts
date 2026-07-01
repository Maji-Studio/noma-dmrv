"use server";

/**
 * Production Run Readings Server Actions
 *
 * Readings are imported from readings CSVs; the only mutation here is a
 * bulk "delete all" used to clear a run before re-importing.
 */

import { z } from "zod";
import {
  getProductionRunReadingsList as getListData,
  deleteAllProductionRunReadings as deleteAllData,
  type ProductionRunReadingWithRelations,
} from "@/data-access/production-run-readings";
import { getUser } from "@/lib/auth/server";
import {
  deleteAllProductionRunReadingsSchema,
  productionRunReadingListFiltersSchema,
} from "@/schemas/production-run-readings";
import type { ActionResult } from "@/types/actions";

export async function getProductionRunReadingsListFn(
  productionRunId?: string,
  facilityId?: string
): Promise<ActionResult<ProductionRunReadingWithRelations[]>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const filters = productionRunReadingListFiltersSchema.parse({
      productionRunId,
      facilityId,
    });

    const readings = await getListData(user.id, filters.productionRunId, filters.facilityId);
    return { success: true, data: readings };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }

    console.error("[production-run-readings] Failed to load readings:", error);
    return {
      success: false,
      error: "Failed to load readings",
    };
  }
}

export async function deleteAllProductionRunReadingsFn(
  data: z.infer<typeof deleteAllProductionRunReadingsSchema>
): Promise<ActionResult<{ deletedCount: number }>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = deleteAllProductionRunReadingsSchema.parse(data);
    const deletedCount = await deleteAllData(user.id, validated.productionRunId);

    return { success: true, data: { deletedCount } };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }

    console.error("[production-run-readings] Failed to delete readings:", error);
    return {
      success: false,
      error: "Failed to delete readings",
    };
  }
}
