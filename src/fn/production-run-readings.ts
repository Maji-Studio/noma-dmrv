"use server";

/**
 * Production Run Readings Server Actions
 * CRUD operations for standalone readings
 */

import { z } from "zod";
import {
  getProductionRunReadingsList as getListData,
  createProductionRunReading as createData,
  updateProductionRunReading as updateData,
  deleteProductionRunReading as deleteData,
  type ProductionRunReadingWithRelations,
} from "@/data-access/production-run-readings";
import { getUser } from "@/lib/auth/server";
import {
  createProductionRunReadingSchema,
  updateProductionRunReadingSchema,
  deleteProductionRunReadingSchema,
  productionRunReadingListFiltersSchema,
} from "@/schemas/production-run-readings";
import type { ActionResult } from "@/types/actions";

function toValidTimestamp(timestamp: string | Date): Date | null {
  const parsed = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

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

export async function createProductionRunReadingFn(
  data: z.infer<typeof createProductionRunReadingSchema>
): Promise<ActionResult<ProductionRunReadingWithRelations>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = createProductionRunReadingSchema.parse(data);
    const timestamp = toValidTimestamp(validated.timestamp);

    if (!timestamp) {
      return {
        success: false,
        error: "Validation error: Invalid timestamp",
      };
    }

    const reading = await createData(user.id, {
      productionRunId: validated.productionRunId,
      timestamp,
      temperatureC: validated.temperatureC ?? null,
      pressureBar: validated.pressureBar ?? null,
      gasFlowRate: validated.gasFlowRate ?? null,
    });

    return { success: true, data: reading };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }

    console.error("[production-run-readings] Failed to create reading:", error);
    return {
      success: false,
      error: "Failed to create reading",
    };
  }
}

export async function updateProductionRunReadingFn(
  data: z.infer<typeof updateProductionRunReadingSchema>
): Promise<ActionResult<ProductionRunReadingWithRelations>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = updateProductionRunReadingSchema.parse(data);

    let timestamp: Date | undefined;
    if (validated.timestamp) {
      const parsed = toValidTimestamp(validated.timestamp);
      if (!parsed) {
        return { success: false, error: "Validation error: Invalid timestamp" };
      }
      timestamp = parsed;
    }

    const reading = await updateData(user.id, validated.readingId, {
      timestamp,
      temperatureC: validated.temperatureC,
      pressureBar: validated.pressureBar,
      gasFlowRate: validated.gasFlowRate,
    });

    return { success: true, data: reading };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }

    console.error("[production-run-readings] Failed to update reading:", error);
    return {
      success: false,
      error: "Failed to update reading",
    };
  }
}

export async function deleteProductionRunReadingFn(
  data: z.infer<typeof deleteProductionRunReadingSchema>
): Promise<ActionResult<void>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = deleteProductionRunReadingSchema.parse(data);
    await deleteData(user.id, validated.readingId);

    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }

    console.error("[production-run-readings] Failed to delete reading:", error);
    return {
      success: false,
      error: "Failed to delete reading",
    };
  }
}
