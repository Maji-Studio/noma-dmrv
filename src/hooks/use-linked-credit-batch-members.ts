import { useQuery } from "@tanstack/react-query";
import { getLinkedCreditBatchMembersFn } from "@/fn/linked-credit-batch-members";
import { unwrap } from "./types";
import { creditBatchKeys } from "./credit-batch-query-keys";

export const linkedCreditBatchMemberKeys = {
  detail: (id: string) => [...creditBatchKeys.all, "linked-credit-batch-members", id] as const,
};

/** Dedicated read-only cache, separate from form options and edit details. */
export function useLinkedCreditBatchMembers(creditBatchId: string, enabled = true) {
  return useQuery({
    queryKey: linkedCreditBatchMemberKeys.detail(creditBatchId),
    queryFn: async () => unwrap(await getLinkedCreditBatchMembersFn(creditBatchId)),
    enabled: !!creditBatchId && enabled,
  });
}
