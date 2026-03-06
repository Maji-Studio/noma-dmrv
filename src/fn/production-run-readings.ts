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

    const readings = await getListData(user.id, productionRunId, facilityId);
    return { success: true, data: readings };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load readings",
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
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to create reading",
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
    const timestamp = validated.timestamp
      ? (toValidTimestamp(validated.timestamp) ?? undefined)
      : undefined;

    if (validated.timestamp && !timestamp) {
      return {
        success: false,
        error: "Validation error: Invalid timestamp",
      };
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
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to update reading",
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
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to delete reading",
    };
  }
}
