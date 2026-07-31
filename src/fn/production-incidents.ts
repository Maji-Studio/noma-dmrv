"use server";

/**
 * Production Incidents Server Actions
 * CRUD operations for production incident reports
 */

import { z } from "zod";
import {
  getProductionIncidents as getProductionIncidentsData,
  createProductionIncident,
  updateProductionIncident,
  deleteProductionIncident,
  type ProductionIncidentWithRelations,
} from "@/data-access/production-incidents";
import { requireOrgContext } from "@/lib/auth/server";
import { toActionError } from "@/lib/errors";
import {
  createProductionIncidentSchema,
  updateProductionIncidentSchema,
  deleteProductionIncidentSchema,
} from "@/schemas/production-incidents";
import type { ActionResult } from "@/types/actions";
import { formatZodActionError } from "./action-errors";

const productionRunIdSchema = z.string().uuid("Production run is required");

function logServerError(context: string, error: unknown): void {
  console.error(`[production-incidents] ${context}`, error);
}

export async function getProductionIncidentsFn(
  productionRunId: string
): Promise<ActionResult<ProductionIncidentWithRelations[]>> {
  try {
    const ctx = await requireOrgContext();

    const validatedProductionRunId = productionRunIdSchema.safeParse(productionRunId);
    if (!validatedProductionRunId.success) {
      return { success: false, error: "Invalid input" };
    }

    const incidents = await getProductionIncidentsData(ctx, validatedProductionRunId.data);
    return { success: true, data: incidents };
  } catch (error) {
    logServerError("getProductionIncidentsFn failed", error);
    return {
      success: false,
      error:
        "Production incidents could not be loaded. Refresh the page and try again.",
    };
  }
}

export async function createProductionIncidentFn(
  data: z.infer<typeof createProductionIncidentSchema>
): Promise<ActionResult<ProductionIncidentWithRelations>> {
  try {
    const ctx = await requireOrgContext();

    const validated = createProductionIncidentSchema.parse(data);

    const incident = await createProductionIncident(ctx, {
      productionRunId: validated.productionRunId,
      incidentTime:
        validated.incidentTime instanceof Date
          ? validated.incidentTime
          : new Date(validated.incidentTime),
      operatorId: validated.operatorId ?? null,
      reactorId: validated.reactorId ?? null,
      description: validated.description,
      severity: validated.severity,
      correctiveActions: validated.correctiveActions || null,
      notes: validated.notes || null,
    });

    return { success: true, data: incident };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    logServerError("createProductionIncidentFn failed", error);
    return {
      success: false,
      error:
        "Production incident was not created. Check the form.",
    };
  }
}

export async function updateProductionIncidentFn(
  data: z.infer<typeof updateProductionIncidentSchema>
): Promise<ActionResult<ProductionIncidentWithRelations>> {
  try {
    const ctx = await requireOrgContext();

    const validated = updateProductionIncidentSchema.parse(data);

    const incident = await updateProductionIncident(
      ctx,
      validated.productionIncidentId,
      {
        incidentTime:
          validated.incidentTime instanceof Date
            ? validated.incidentTime
            : new Date(validated.incidentTime),
        operatorId: validated.operatorId ?? null,
        reactorId: validated.reactorId ?? null,
        description: validated.description,
        severity: validated.severity,
        correctiveActions: validated.correctiveActions || null,
        notes: validated.notes || null,
      }
    );

    return { success: true, data: incident };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    logServerError("updateProductionIncidentFn failed", error);
    return {
      success: false,
      error: "Production incident was not saved. Try again.",
    };
  }
}

export async function deleteProductionIncidentFn(
  data: z.infer<typeof deleteProductionIncidentSchema>
): Promise<ActionResult<void>> {
  try {
    const ctx = await requireOrgContext();

    const validated = deleteProductionIncidentSchema.parse(data);
    await deleteProductionIncident(ctx, validated.productionIncidentId);

    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    logServerError("deleteProductionIncidentFn failed", error);
    return {
      success: false,
      error: toActionError(error, "Failed to delete production incident"),
    };
  }
}
