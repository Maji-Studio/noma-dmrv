import type { QueryClient } from "@tanstack/react-query";
import type { TransportDistanceTarget } from "@/schemas/transport-distance-refresh";
import { activityKeys } from "./activity-query-keys";
import { chainOfCustodyKeys } from "./use-chain-of-custody";
import { transportLegKeys } from "./use-transport-legs";

// Location writes already invalidate transport legs, including these drift reads.
export const transportDistanceKeys = {
  all: [...transportLegKeys.all, "distance"] as const,
  detail: (target: TransportDistanceTarget) => [...transportDistanceKeys.all, target.entityType, target.entityId] as const,
};

/**
 * Feedstock and delivery writes resync their derived leg (an override set or
 * cleared, a route change), so the leg reads, their drift reads (nested under
 * the leg keys) and the routes drawn from them refresh, as after a deliberate
 * refresh from location.
 */
export function invalidateRecordedTransport(queryClient: QueryClient) {
  return Promise.all([transportLegKeys.all, chainOfCustodyKeys.all, activityKeys.all]
    .map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}
