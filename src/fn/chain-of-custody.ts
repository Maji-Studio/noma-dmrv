"use server";

import { z } from "zod";
import {
  getChainOfCustodyData,
  type ChainOfCustodyData,
} from "@/data-access/chain-of-custody";
import {
  getChainOfCustodyGeoData,
  type ChainOfCustodyGeoData,
} from "@/data-access/chain-of-custody-geo";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

const applicationIdSchema = z.uuid();

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

export async function getChainOfCustodyGeoFn(
  applicationId: string
): Promise<ActionResult<ChainOfCustodyGeoData>> {
  return withAction(
    async (userId) => {
      const validatedApplicationId = applicationIdSchema.parse(applicationId);
      return getChainOfCustodyGeoData(userId, validatedApplicationId);
    },
    {
      zodErrorPrefix: "Invalid application ID",
      fallbackMessage: "Failed to load chain of custody map data",
    }
  );
}
