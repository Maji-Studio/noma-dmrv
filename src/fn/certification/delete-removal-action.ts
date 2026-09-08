"use server";

import { requireOrgFacility } from "@/data-access/utils";
import {
  deleteRemovalSchema,
  type DeleteRemovalInput,
} from "@/schemas/certification";
import type { ActionResult } from "@/types/actions";
import { deleteRemoval, type RemovalDeletionResult } from "./delete-removal";
import { submitRateLimit } from "./shared";
import { withAction } from "../with-action";

export async function deleteRemovalAction(
  input: DeleteRemovalInput,
): Promise<ActionResult<RemovalDeletionResult>> {
  return withAction(async (ctx) => {
    const parsed = deleteRemovalSchema.parse(input);
    await requireOrgFacility(ctx, parsed.facilityId);
    return deleteRemoval(ctx, parsed);
  }, { rateLimit: submitRateLimit("cert:delete-removal") });
}
