import type { TransportDistanceTarget } from "@/schemas/transport-distance-refresh";
import { transportLegKeys } from "./use-transport-legs";

// Location writes already invalidate transport legs, including these drift reads.
export const transportDistanceKeys = {
  all: [...transportLegKeys.all, "distance"] as const,
  detail: (target: TransportDistanceTarget) => [...transportDistanceKeys.all, target.entityType, target.entityId] as const,
};
