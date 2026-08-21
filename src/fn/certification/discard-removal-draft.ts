"use server";

import { discardLocalRemovalDraft } from "@/data-access/certifier-removals";
import { requireOrgFacility } from "@/data-access/utils";
import {
  discardRemovalDraftSchema,
  type DiscardRemovalDraftInput,
} from "@/schemas/certification";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";

export async function discardRemovalDraftAction(
  input: DiscardRemovalDraftInput,
): Promise<ActionResult<{ releasedSliceCount: number }>> {
  return withAction(async (ctx) => {
    const { facilityId, removalId } = discardRemovalDraftSchema.parse(input);
    await requireOrgFacility(ctx, facilityId);
    return discardLocalRemovalDraft(ctx, facilityId, removalId);
  });
}
