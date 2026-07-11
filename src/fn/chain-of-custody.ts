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
import {
  getCreditBatchChainData,
  getCreditBatchChainGeoData,
  type CreditBatchChainData,
} from "@/data-access/chain-of-custody-batch";
import {
  getApplicationTrailEvidence,
  type ApplicationTrailEvidence,
} from "@/data-access/chain-of-custody-trail";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

const applicationIdSchema = z.uuid();
const creditBatchIdSchema = z.uuid();

export async function getChainOfCustodyFn(
  applicationId: string
): Promise<ActionResult<ChainOfCustodyData>> {
  return withAction(
    async (ctx) => {
      const validatedApplicationId = applicationIdSchema.parse(applicationId);
      return getChainOfCustodyData(ctx, validatedApplicationId);
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
    async (ctx) => {
      const validatedApplicationId = applicationIdSchema.parse(applicationId);
      return getChainOfCustodyGeoData(ctx, validatedApplicationId);
    },
    {
      zodErrorPrefix: "Invalid application ID",
      fallbackMessage: "Failed to load chain of custody map data",
    }
  );
}

export async function getCreditBatchChainFn(
  creditBatchId: string
): Promise<ActionResult<CreditBatchChainData>> {
  return withAction(
    async (ctx) => {
      const validatedId = creditBatchIdSchema.parse(creditBatchId);
      return getCreditBatchChainData(ctx, validatedId);
    },
    {
      zodErrorPrefix: "Invalid credit batch ID",
      fallbackMessage: "Failed to load credit batch chain of custody data",
    }
  );
}

export async function getCreditBatchChainGeoFn(
  creditBatchId: string
): Promise<ActionResult<ChainOfCustodyGeoData>> {
  return withAction(
    async (ctx) => {
      const validatedId = creditBatchIdSchema.parse(creditBatchId);
      return getCreditBatchChainGeoData(ctx, validatedId);
    },
    {
      zodErrorPrefix: "Invalid credit batch ID",
      fallbackMessage: "Failed to load credit batch map data",
    }
  );
}

export async function getApplicationTrailFn(
  applicationId: string
): Promise<ActionResult<ApplicationTrailEvidence>> {
  return withAction(
    async (ctx) => {
      const validatedApplicationId = applicationIdSchema.parse(applicationId);
      return getApplicationTrailEvidence(ctx, validatedApplicationId);
    },
    {
      zodErrorPrefix: "Invalid application ID",
      fallbackMessage: "Failed to load trail evidence",
    }
  );
}
