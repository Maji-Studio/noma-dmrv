"use server";

import {
  getIsometricClientForOrg,
  listFeedstockTypes,
  type IsometricFeedstockType,
} from "@/lib/isometric";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { safeListIfConfigured } from "./shared";

// Read-only browse of the registry's feedstock-type catalogue for the
// feedstock-type form's Isometric tab. Browse-only by design: no local
// record is created from registry entries (locked decision 3 in the
// 2026-06-10 feature-batch plan). Empty when Isometric isn't configured.
export async function loadIsometricFeedstockTypes(): Promise<
  ActionResult<IsometricFeedstockType[]>
> {
  return withAction(async (orgCtx) => {
    const client = await getIsometricClientForOrg(orgCtx.organizationId);
    return safeListIfConfigured(() => listFeedstockTypes(client));
  });
}
