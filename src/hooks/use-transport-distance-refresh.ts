import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getTransportDistanceDriftFn, refreshDeliveryDistanceFn, refreshFeedstockDistanceFn } from "@/fn/transport-distance-refresh";
import type { TransportDistanceDrift } from "@/data-access/transport-distance-drift";
import type { RefreshTransportDistanceInput, TransportDistanceTarget } from "@/schemas/transport-distance-refresh";
import { throwActionError } from "@/lib/stale-version";
import { unwrap, type MutationCallbacks } from "./types";
import { feedstockKeys } from "./use-feedstocks";
import { deliveryKeys } from "./use-deliveries";
import { transportLegKeys } from "./use-transport-legs";
import { chainOfCustodyKeys } from "./use-chain-of-custody";
import { activityKeys } from "./activity-query-keys";
import { dashboardOverviewKeys } from "./use-dashboard-overview";
import { invalidateCertificationReadiness } from "./use-certification";

export { transportDistanceKeys } from "./transport-distance-query-keys";
import { transportDistanceKeys } from "./transport-distance-query-keys";

export function useTransportDistanceDrift(target: TransportDistanceTarget, enabled = true) {
  return useQuery({
    queryKey: transportDistanceKeys.detail(target),
    queryFn: async () => unwrap(await getTransportDistanceDriftFn(target)),
    enabled: enabled && !!target.entityId,
    // Reopening a record must see location edits from other screens.
    staleTime: 0,
  });
}

export function useRefreshTransportDistance(
  entityType: TransportDistanceTarget["entityType"],
  callbacks?: MutationCallbacks<TransportDistanceDrift, RefreshTransportDistanceInput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RefreshTransportDistanceInput) => {
      const result = await (entityType === "feedstock" ? refreshFeedstockDistanceFn(input) : refreshDeliveryDistanceFn(input));
      if (!result.success) throwActionError(result);
      return result.data;
    },
    onSuccess: async (data, variables) => {
      queryClient.setQueryData(transportDistanceKeys.detail({ entityType, entityId: variables.entityId }), data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: transportDistanceKeys.all }),
        queryClient.invalidateQueries({ queryKey: feedstockKeys.all }),
        queryClient.invalidateQueries({ queryKey: deliveryKeys.all }),
        queryClient.invalidateQueries({ queryKey: transportLegKeys.all }),
        queryClient.invalidateQueries({ queryKey: dashboardOverviewKeys.all }),
        queryClient.invalidateQueries({ queryKey: chainOfCustodyKeys.all }),
        queryClient.invalidateQueries({ queryKey: activityKeys.all }),
        invalidateCertificationReadiness(queryClient),
      ]);
      await callbacks?.onSuccess?.(data, variables);
    },
    onError: callbacks?.onError,
  });
}
