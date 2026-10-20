"use server";

import { recordTransportLeg } from "@/lib/operations/transport-legs";
import { runOperationInProcess } from "@/lib/operations/runner";
import { createIntentOptionsSchema, type CreateIntentOptions } from "@/schemas/create-intent";
import {
  deleteTransportLeg,
  getTransportLegsForEntity,
  type TransportLegWithEvidence,
  updateTransportLeg,
  type TransportEntityType,
} from "@/data-access/transport-legs";
import { withAction } from "@/fn/with-action";
import {
  createTransportLegSchema,
  deleteTransportLegSchema,
  transportEntityTypes,
  updateTransportLegSchema,
  type CreateTransportLegData,
  type DeleteTransportLegData,
  type UpdateTransportLegData,
} from "@/schemas/transport-legs";
import { resolveDistanceSource } from "@/schemas/distance-source";
import type { TransportLeg } from "@/db/schema";
import type { ActionResult } from "@/types/actions";
import { z } from "zod";

const listInputSchema = z.object({
  entityType: z.enum(transportEntityTypes),
  entityId: z.string().uuid("Invalid entity id"),
});

export async function getTransportLegsForEntityFn(input: {
  entityType: TransportEntityType;
  entityId: string;
}): Promise<ActionResult<TransportLegWithEvidence[]>> {
  return withAction(async (ctx) => {
    const { entityType, entityId } = listInputSchema.parse(input);
    return getTransportLegsForEntity(ctx, entityType, entityId);
  });
}

export async function createTransportLegFn(
  input: CreateTransportLegData,
  options?: CreateIntentOptions,
): Promise<ActionResult<TransportLeg>> {
  return withAction(async (ctx) => {
    const parsed = createTransportLegSchema.parse(input);
    const parsedOptions = createIntentOptionsSchema.parse(options);
    return runOperationInProcess(recordTransportLeg, ctx, {
      ...parsed,
      // Explicit/manual legs own their distance + provenance; a leg saved
      // without one was hand-typed.
      distanceSource: resolveDistanceSource(parsed.distanceKm, parsed.distanceSource) ?? null,
    }, parsedOptions);
  });
}

export async function updateTransportLegFn(
  input: UpdateTransportLegData,
): Promise<ActionResult<TransportLeg>> {
  return withAction(async (ctx) => {
    const { id, ...rest } = updateTransportLegSchema.parse(input);
    return updateTransportLeg(ctx, id, {
      ...rest,
      distanceSource: resolveDistanceSource(rest.distanceKm, rest.distanceSource) ?? null,
    });
  });
}

export async function deleteTransportLegFn(input: DeleteTransportLegData): Promise<ActionResult<void>> {
  return withAction(async (ctx) => {
    const { id, expectedVersion } = deleteTransportLegSchema.parse(input);
    await deleteTransportLeg(ctx, id, expectedVersion);
  });
}
