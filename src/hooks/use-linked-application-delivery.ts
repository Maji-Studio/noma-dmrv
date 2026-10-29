import { useQuery } from "@tanstack/react-query";
import { getLinkedApplicationDeliveryFn } from "@/fn/linked-application-delivery";
import { applicationKeys } from "./use-applications";
import { unwrap } from "./types";

/** Dedicated read-only cache, separate from form options and edit details. */
export function useLinkedApplicationDelivery(applicationId: string, enabled = true) {
  return useQuery({
    queryKey: applicationKeys.linkedDelivery(applicationId),
    queryFn: async () => unwrap(await getLinkedApplicationDeliveryFn(applicationId)),
    enabled: !!applicationId && enabled,
  });
}
