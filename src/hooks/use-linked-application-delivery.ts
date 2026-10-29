import { useQuery } from "@tanstack/react-query";
import { getLinkedApplicationDeliveryFn } from "@/fn/linked-application-delivery";
import { unwrap } from "./types";

export const linkedApplicationDeliveryKeys = {
  detail: (id: string) => ["applications", "linked-application-delivery", id] as const,
};

/** Dedicated read-only cache, separate from form options and edit details. */
export function useLinkedApplicationDelivery(applicationId: string, enabled = true) {
  return useQuery({
    queryKey: linkedApplicationDeliveryKeys.detail(applicationId),
    queryFn: async () => unwrap(await getLinkedApplicationDeliveryFn(applicationId)),
    enabled: !!applicationId && enabled,
  });
}
