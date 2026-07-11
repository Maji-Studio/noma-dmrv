"use server";

import {
  createTransportLeg,
  deleteTransportLeg,
  getTransportLegsForEntity,
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
}): Promise<ActionResult<TransportLeg[]>> {
  return withAction(async (ctx) => {
    const { entityType, entityId } = listInputSchema.parse(input);
    return getTransportLegsForEntity(ctx, entityType, entityId);
  });
}

export async function createTransportLegFn(
  input: CreateTransportLegData,
): Promise<ActionResult<TransportLeg>> {
  return withAction(async (ctx) => {
    const parsed = createTransportLegSchema.parse(input);
    return createTransportLeg(ctx, {
      ...parsed,
      // Explicit/manual legs own their distance + provenance; a leg saved
      // without one was hand-typed.
      distanceSource: resolveDistanceSource(parsed.distanceKm, parsed.distanceSource) ?? null,
    });
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

export async function deleteTransportLegFn(input: {
  id: string;
}): Promise<ActionResult<void>> {
  return withAction(async (ctx) => {
    const { id } = deleteTransportLegSchema.parse(input);
    await deleteTransportLeg(ctx, id);
  });
}
