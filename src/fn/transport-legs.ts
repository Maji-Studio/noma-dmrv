"use server";

/**
 * Transport Legs Server Actions
 *
 * Server-side wrappers around `src/data-access/transport-legs.ts`.
 * Each action validates input with Zod and returns an `ActionResult<T>`.
 */

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
  return withAction(async (userId) => {
    const { entityType, entityId } = listInputSchema.parse(input);
    return getTransportLegsForEntity(userId, entityType, entityId);
  });
}

export async function createTransportLegFn(
  input: CreateTransportLegData,
): Promise<ActionResult<TransportLeg>> {
  return withAction(async (userId) => {
    const parsed = createTransportLegSchema.parse(input);
    return createTransportLeg(userId, parsed);
  });
}

export async function updateTransportLegFn(
  input: UpdateTransportLegData,
): Promise<ActionResult<TransportLeg>> {
  return withAction(async (userId) => {
    const { id, ...rest } = updateTransportLegSchema.parse(input);
    return updateTransportLeg(userId, id, rest);
  });
}

export async function deleteTransportLegFn(input: {
  id: string;
}): Promise<ActionResult<void>> {
  return withAction(async (userId) => {
    const { id } = deleteTransportLegSchema.parse(input);
    await deleteTransportLeg(userId, id);
  });
}
