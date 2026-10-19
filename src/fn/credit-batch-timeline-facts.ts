"use server";

import { z } from "zod";
import { uuidSchema } from "@/schemas/helpers";
import {
  listCreditBatchTimelineFacts,
  type CreditBatchTimelineFacts,
} from "@/data-access/credit-batch-timeline-facts";
import { requireOrgFacility } from "@/data-access/utils";
import { SafeError } from "@/lib/errors";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

/** One request covers a facility's batches for the timeline; the cap bounds a single fan-out. */
const MAX_TIMELINE_BATCHES = 200;

export async function loadCreditBatchTimelineFactsFn(
  facilityId: string,
  batchIds: string[],
): Promise<ActionResult<Record<string, CreditBatchTimelineFacts>>> {
  return withAction(async (ctx) => {
    const validFacilityId = uuidSchema().parse(facilityId);
    await requireOrgFacility(ctx, validFacilityId);
    const ids = z.array(uuidSchema()).max(MAX_TIMELINE_BATCHES).parse(batchIds);
    const facts = await listCreditBatchTimelineFacts(ctx, ids);
    if (Object.values(facts).some((row) => row.facilityId !== validFacilityId)) {
      throw new SafeError("Batch does not belong to requested facility");
    }
    return facts;
  }, {
    fallbackMessage: "Failed to load credit batch timeline facts",
    log: { message: "Failed to load credit batch timeline facts", context: { op: "credit-batch:timeline-facts" } },
  });
}
