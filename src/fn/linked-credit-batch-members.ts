"use server";

import { z } from "zod";
import { getLinkedCreditBatchMembers } from "@/data-access/linked-credit-batch-members";
import { withAction } from "./with-action";
import type { ActionResult } from "@/types/actions";

export async function getLinkedCreditBatchMembersFn(creditBatchId: string): Promise<ActionResult<Awaited<ReturnType<typeof getLinkedCreditBatchMembers>>>> {
  return withAction(ctx => getLinkedCreditBatchMembers(ctx, z.uuid().parse(creditBatchId)), {
    fallbackMessage: "Failed to load linked record",
    log: { message: "linked record read failed", context: { op: "linked-credit-batch-members:read" } },
  });
}
