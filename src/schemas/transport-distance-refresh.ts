import { z } from "zod";
import { expectedVersionSchema, uuidSchema } from "./helpers";

export const transportDistanceTargetSchema = z.object({
  entityType: z.enum(["feedstock", "delivery"]),
  entityId: uuidSchema(),
});

export const refreshTransportDistanceSchema = z.object({
  entityId: uuidSchema(),
  expectedVersion: expectedVersionSchema,
});

export type TransportDistanceTarget = z.infer<typeof transportDistanceTargetSchema>;
export type RefreshTransportDistanceInput = z.infer<typeof refreshTransportDistanceSchema>;
