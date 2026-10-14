"use server";

/**
 * Feedstock Server Actions
 * Unified server-side functions for the combined delivery + bin allocation workflow.
 */

import { z } from "zod";
import { requireOrgFacility } from "@/data-access/utils";
import {
  getFeedstocks as getFeedstocksData,
  getFeedstockById as getFeedstockByIdData,
  getFeedstockStats as getFeedstockStatsData,
  type PaginatedFeedstocks,
  type FeedstockWithRelations,
  type FeedstockStats,
  type CreateFeedstockResult,
} from "@/data-access/feedstocks";
import {
  createFeedstockSchema,
  deleteFeedstockSchema,
  updateFeedstockSchema,
  feedstockFilterSchema,
  feedstockStatsFilterSchema,
} from "@/schemas/feedstocks";
import { logFeedstockDelivery, updateFeedstock, deleteFeedstock } from "@/lib/operations/feedstocks";
import { runOperationInProcess } from "@/lib/operations/runner";
import { withAction } from "./with-action";
import type { ActionResult } from "@/types/actions";

// ============================================
// List/Query Operations
// ============================================

export async function getFeedstocksFn(
  filters?: Partial<z.infer<typeof feedstockFilterSchema>>
): Promise<ActionResult<PaginatedFeedstocks>> {
  return withAction(async (ctx) => {
    const validatedFilters = filters
      ? feedstockFilterSchema.parse(filters)
      : undefined;
    if (validatedFilters?.facilityId) {
      await requireOrgFacility(ctx, validatedFilters.facilityId);
    }
    const data = await getFeedstocksData(ctx, validatedFilters);

    return data;
  }, {
    fallbackMessage: "Failed to load feedstocks",
    zodErrorPrefix: "Invalid filter parameters",
    log: { message: "feedstock action failed", context: { op: "feedstock:list" } },
  });
}

export async function getFeedstockByIdFn(
  feedstockId: string
): Promise<ActionResult<FeedstockWithRelations>> {
  return withAction(async (ctx) => {
    const data = await getFeedstockByIdData(ctx, feedstockId);
    return data;
  }, {
    fallbackMessage: "Failed to load feedstock",
    log: { message: "feedstock action failed", context: { op: "feedstock:get" } },
  });
}

export async function getFeedstockStatsFn(
  scope?: Partial<z.infer<typeof feedstockStatsFilterSchema>>
): Promise<ActionResult<FeedstockStats>> {
  return withAction(async (ctx) => {
    const validatedScope = scope
      ? feedstockStatsFilterSchema.parse(scope)
      : undefined;
    if (validatedScope?.facilityId) {
      await requireOrgFacility(ctx, validatedScope.facilityId);
    }
    const data = await getFeedstockStatsData(ctx, validatedScope);
    return data;
  }, {
    fallbackMessage: "Failed to load feedstock stats",
    zodErrorPrefix: "Invalid filter parameters",
    log: { message: "feedstock action failed", context: { op: "feedstock:stats" } },
  });
}

// ============================================
// Create Operation
// ============================================

export async function createFeedstockFn(
  input: z.infer<typeof createFeedstockSchema>
): Promise<ActionResult<CreateFeedstockResult>> {
  return withAction((ctx) => runOperationInProcess(logFeedstockDelivery, ctx, input), {
    fallbackMessage: "Failed to create feedstock",
    log: { message: "feedstock action failed", context: { op: "feedstock:create" } },
  });
}

export async function updateFeedstockFn(
  input: z.infer<typeof updateFeedstockSchema>
): Promise<ActionResult<FeedstockWithRelations>> {
  return withAction((ctx) => runOperationInProcess(updateFeedstock, ctx, input), {
    fallbackMessage: "Failed to update feedstock",
    log: { message: "feedstock action failed", context: { op: "feedstock:update" } },
  });
}

export async function deleteFeedstockFn(
  input: z.infer<typeof deleteFeedstockSchema>
): Promise<ActionResult<void>> {
  return withAction((ctx) => runOperationInProcess(deleteFeedstock, ctx, input), {
    fallbackMessage: "Failed to delete feedstock",
    log: { message: "feedstock action failed", context: { op: "feedstock:delete" } },
  });
}
