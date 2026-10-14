"use server";

/**
 * Production Run Readings Server Actions
 *
 * Readings are imported from readings CSVs; the only mutation here is a
 * bulk "delete all" used to clear a run before re-importing.
 */

import { withAction } from "./with-action";
import { z } from "zod";
import {
  getProductionRunReadingsList as getListData,
  deleteAllProductionRunReadings as deleteAllData,
  type ProductionRunReadingWithRelations,
} from "@/data-access/production-run-readings";
import { requireOrgFacility } from "@/data-access/utils";
import {
  deleteAllProductionRunReadingsSchema,
  productionRunReadingListFiltersSchema,
} from "@/schemas/production-run-readings";
import type { ActionResult } from "@/types/actions";

export async function getProductionRunReadingsListFn(
  productionRunId?: string,
  facilityId?: string
): Promise<ActionResult<ProductionRunReadingWithRelations[]>> {
  return withAction(async (ctx) => {
    const filters = productionRunReadingListFiltersSchema.parse({
      productionRunId,
      facilityId,
    });
    if (filters.facilityId) {
      await requireOrgFacility(ctx, filters.facilityId);
    }

    const readings = await getListData(ctx, filters.productionRunId, filters.facilityId);
    return readings;
  }, {
    fallbackMessage: "Failed to load readings",
    log: { message: "production-run-readings list failed", context: { op: "production-run-readings:list" } },
  });
}

export async function deleteAllProductionRunReadingsFn(
  data: z.infer<typeof deleteAllProductionRunReadingsSchema>
): Promise<ActionResult<{ deletedCount: number }>> {
  return withAction(async (ctx) => {
    const validated = deleteAllProductionRunReadingsSchema.parse(data);
    const deletedCount = await deleteAllData(ctx, validated.productionRunId);

    return { deletedCount };
  }, {
    fallbackMessage: "Failed to delete readings",
    log: { message: "production-run-readings delete failed", context: { op: "production-run-readings:deleteAll" } },
  });
}
