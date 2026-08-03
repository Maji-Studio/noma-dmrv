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
import { requireOrgFacility } from "@/data-access/utils";
import { requireOrgContext } from "@/lib/auth/server";
import {
  formatZodActionError,
  toLoggedActionError,
} from "./action-errors";
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
    const ctx = await requireOrgContext();

    const filters = productionRunReadingListFiltersSchema.parse({
      productionRunId,
      facilityId,
    });
    if (filters.facilityId) {
      await requireOrgFacility(ctx, filters.facilityId);
    }

    const readings = await getListData(ctx, filters.productionRunId, filters.facilityId);
    return { success: true, data: readings };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }

    return {
      success: false,
      error: toLoggedActionError(error, "Failed to load readings", {
        message: "production-run-readings list failed",
        context: { op: "production-run-readings:list" },
      }),
    };
  }
}

export async function deleteAllProductionRunReadingsFn(
  data: z.infer<typeof deleteAllProductionRunReadingsSchema>
): Promise<ActionResult<{ deletedCount: number }>> {
  try {
    const ctx = await requireOrgContext();

    const validated = deleteAllProductionRunReadingsSchema.parse(data);
    const deletedCount = await deleteAllData(ctx, validated.productionRunId);

    return { success: true, data: { deletedCount } };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }

    return {
      success: false,
      error: toLoggedActionError(error, "Failed to delete readings", {
        message: "production-run-readings delete failed",
        context: { op: "production-run-readings:deleteAll" },
      }),
    };
  }
}
