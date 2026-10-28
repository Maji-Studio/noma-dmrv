"use server";
import { recordProductionIncident } from "@/lib/operations/production-incidents";
import type { CreateIntentOptions } from "@/schemas/create-intent";
import { withAction } from "./with-action";
import { withCreate } from "./with-create";

/**
 * Production Incidents Server Actions
 * CRUD operations for production incident reports
 */

import { SafeError } from "@/lib/errors";
import { z } from "zod";
import {
  getProductionIncidents as getProductionIncidentsData,
  updateProductionIncident,
  deleteProductionIncident,
  type ProductionIncidentWithRelations,
} from "@/data-access/production-incidents";
import {
  createProductionIncidentSchema,
  updateProductionIncidentSchema,
  deleteProductionIncidentSchema,
} from "@/schemas/production-incidents";
import type { ActionResult } from "@/types/actions";

const LOAD_FAILURE = "Production incidents could not be loaded. Refresh the page and try again.";
const CREATE_FAILURE = "Production incident was not created. Check the form.";
const INVALID_INPUT = "Invalid input";

const productionRunIdSchema = z.string().uuid("Production run is required");

class InvalidProductionRunInputError extends SafeError {}

export async function getProductionIncidentsFn(
  productionRunId: string
): Promise<ActionResult<ProductionIncidentWithRelations[]>> {
  return withAction(async (ctx) => {
    const validatedProductionRunId = productionRunIdSchema.safeParse(productionRunId);
    if (!validatedProductionRunId.success) {
      throw new InvalidProductionRunInputError(INVALID_INPUT);
    }

    const incidents = await getProductionIncidentsData(ctx, validatedProductionRunId.data);
    return incidents;
  }, {
    fallbackMessage: LOAD_FAILURE,
    log: { message: "getProductionIncidentsFn failed", context: { op: "production-incident:list" } },
    mapError: (error) => {
      if (error instanceof InvalidProductionRunInputError) {
        return { success: false as const, error: INVALID_INPUT };
      }
      return error instanceof SafeError
        ? { success: false as const, error: LOAD_FAILURE }
        : undefined;
    },
  });
}

export async function createProductionIncidentFn(
  data: z.infer<typeof createProductionIncidentSchema>,
  options?: CreateIntentOptions,
): Promise<ActionResult<ProductionIncidentWithRelations>> {
  return withCreate(async (_ctx, create) => {
    const validated = createProductionIncidentSchema.parse(data);

    return create(recordProductionIncident, validated);
  }, options, {
    fallbackMessage: CREATE_FAILURE,
    log: { message: "createProductionIncidentFn failed", context: { op: "production-incident:create" } },
    mapError: (error) =>
      error instanceof SafeError
        ? { success: false as const, error: CREATE_FAILURE }
        : undefined,
  });
}

export async function updateProductionIncidentFn(
  data: z.infer<typeof updateProductionIncidentSchema>
): Promise<ActionResult<ProductionIncidentWithRelations>> {
  return withAction(async (ctx) => {
    const validated = updateProductionIncidentSchema.parse(data);

    const incident = await updateProductionIncident(
      ctx,
      validated.productionIncidentId,
      {
        expectedVersion: validated.expectedVersion,
        incidentTime: validated.incidentTime,
        operatorId: validated.operatorId ?? null,
        reactorId: validated.reactorId ?? null,
        description: validated.description,
        severity: validated.severity,
        correctiveActions: validated.correctiveActions || null,
        notes: validated.notes || null,
      }
    );

    return incident;
  }, {
    fallbackMessage: "Production incident was not saved. Try again.",
    log: { message: "updateProductionIncidentFn failed", context: { op: "production-incident:update" } },
  });
}

export async function deleteProductionIncidentFn(
  data: z.infer<typeof deleteProductionIncidentSchema>
): Promise<ActionResult<void>> {
  return withAction(async (ctx) => {
    const validated = deleteProductionIncidentSchema.parse(data);
    await deleteProductionIncident(ctx, validated.productionIncidentId, validated.expectedVersion);

    return;
  }, {
    fallbackMessage: "Failed to delete production incident",
    log: { message: "deleteProductionIncidentFn failed", context: { op: "production-incident:delete" } },
  });
}
