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
import { requireOrgContext } from "@/lib/auth/server";
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
import {
  formatZodActionError,
  toLoggedActionError,
} from "./action-errors";

function feedstockActionError(
  error: unknown,
  fallbackMessage: string,
  op: string,
): string {
  return toLoggedActionError(error, fallbackMessage, {
    message: "feedstock action failed",
    context: { op },
  });
}

// ============================================
// List/Query Operations
// ============================================

export async function getFeedstocksFn(
  filters?: Partial<z.infer<typeof feedstockFilterSchema>>
): Promise<ActionResult<PaginatedFeedstocks>> {
  try {
    const ctx = await requireOrgContext();

    const validatedFilters = filters
      ? feedstockFilterSchema.parse(filters)
      : undefined;
    if (validatedFilters?.facilityId) {
      await requireOrgFacility(ctx, validatedFilters.facilityId);
    }
    const data = await getFeedstocksData(ctx, validatedFilters);

    return { success: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error, "Invalid filter parameters"),
      };
    }
    return {
      success: false,
      error: feedstockActionError(
        error,
        "Failed to load feedstocks",
        "feedstock:list",
      ),
    };
  }
}

export async function getFeedstockByIdFn(
  feedstockId: string
): Promise<ActionResult<FeedstockWithRelations>> {
  try {
    const ctx = await requireOrgContext();

    const data = await getFeedstockByIdData(ctx, feedstockId);
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: feedstockActionError(
        error,
        "Failed to load feedstock",
        "feedstock:get",
      ),
    };
  }
}

export async function getFeedstockStatsFn(
  scope?: Partial<z.infer<typeof feedstockStatsFilterSchema>>
): Promise<ActionResult<FeedstockStats>> {
  try {
    const ctx = await requireOrgContext();

    const validatedScope = scope
      ? feedstockStatsFilterSchema.parse(scope)
      : undefined;
    if (validatedScope?.facilityId) {
      await requireOrgFacility(ctx, validatedScope.facilityId);
    }
    const data = await getFeedstockStatsData(ctx, validatedScope);
    return { success: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error, "Invalid filter parameters"),
      };
    }
    return {
      success: false,
      error: feedstockActionError(
        error,
        "Failed to load feedstock stats",
        "feedstock:stats",
      ),
    };
  }
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
