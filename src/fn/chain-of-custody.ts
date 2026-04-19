"use server";

import { z } from "zod";
import {
  getChainOfCustodyData,
  type ChainOfCustodyData,
} from "@/data-access/chain-of-custody";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

const applicationIdSchema = z.string().uuid();

export async function getChainOfCustodyFn(
  applicationId: string
): Promise<ActionResult<ChainOfCustodyData>> {
  return withAction(
    async (userId) => {
      const validatedApplicationId = applicationIdSchema.parse(applicationId);
      return getChainOfCustodyData(userId, validatedApplicationId);
    },
    {
      zodErrorPrefix: "Invalid application ID",
      fallbackMessage: "Failed to load chain of custody data",
    }
  );
}
