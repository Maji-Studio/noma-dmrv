"use server";

import { listCreditBatchCertificationLinks } from "@/data-access/credit-batch-certification-links";
import { requireOrgFacility } from "@/data-access/utils";
import { SafeError } from "@/lib/errors";
import { uuidSchema } from "@/schemas/helpers";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { loadCreditBatchTodos, type CreditBatchTodos } from "./credit-batch-todos-core";

export async function loadCreditBatchTodosFn(
  facilityId: string,
  creditBatchId: string,
): Promise<ActionResult<CreditBatchTodos>> {
  return withAction(async (ctx) => {
    const validFacilityId = uuidSchema().parse(facilityId);
    const validBatchId = uuidSchema().parse(creditBatchId);
    await requireOrgFacility(ctx, validFacilityId);
    const [batch] = await listCreditBatchCertificationLinks(ctx, [validBatchId]);
    if (!batch) throw new SafeError("Credit batch was not found.");
    if (batch.facilityId !== validFacilityId) {
      throw new SafeError("Batch does not belong to requested facility");
    }
    const todos = await loadCreditBatchTodos(ctx, validFacilityId, [batch]);
    const batchTodos = todos.get(validBatchId);
    if (!batchTodos) throw new SafeError("Credit batch was not found.");
    return batchTodos;
  });
}
