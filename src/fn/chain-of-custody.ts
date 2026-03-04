"use server";

/**
 * Chain of Custody Server Actions
 */

import { z } from "zod";
import { getUser } from "@/lib/auth/server";
import { getChainOfCustodyData, type ChainOfCustodyData } from "@/data-access/chain-of-custody";
import type { ActionResult } from "@/types/actions";

const facilityIdSchema = z.string().uuid();

export async function getChainOfCustodyFn(
  facilityId: string
): Promise<ActionResult<ChainOfCustodyData>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = facilityIdSchema.parse(facilityId);
    const data = await getChainOfCustodyData(user.id, validated);

    return { success: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: "Invalid facility ID" };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load chain of custody data",
    };
  }
}
