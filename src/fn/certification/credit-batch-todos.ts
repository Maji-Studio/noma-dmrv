"use server";

import { z } from "zod";
import { listCreditBatchCertificationLinks } from "@/data-access/credit-batch-certification-links";
import { requireOrgFacility } from "@/data-access/utils";
import { SafeError } from "@/lib/errors";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { loadCreditBatchTodos, type CreditBatchTodos } from "./credit-batch-todos-core";

export async function loadCreditBatchTodosFn(
  facilityId: string,
  creditBatchId: string,
): Promise<ActionResult<CreditBatchTodos>> {
  return withAction(async (ctx) => {
    const validFacilityId = z.uuid().parse(facilityId);
    const validBatchId = z.uuid().parse(creditBatchId);
    await requireOrgFacility(ctx, validFacilityId);
    const [batch] = await listCreditBatchCertificationLinks(ctx, [validBatchId]);
    if (!batch || batch.facilityId !== validFacilityId) {
      throw new SafeError("Batch does not belong to requested facility");
    }
    const todos = await loadCreditBatchTodos(ctx, validFacilityId, [batch]);
    return todos.get(validBatchId)!;
  });
}
