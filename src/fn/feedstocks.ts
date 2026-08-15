"use server";

/**
 * Feedstock Server Actions
 * Unified server-side functions for the combined delivery + bin allocation workflow.
 */

import { z } from "zod";
import { feedstocks as feedstocksTable } from "@/db/schema";
import { generateNextCodes } from "@/data-access/code-generator";
import { requireOrgFacility } from "@/data-access/utils";
import {
  createFeedstock,
  deleteFeedstock,
  getFeedstocks as getFeedstocksData,
  getFeedstockById as getFeedstockByIdData,
  getFeedstockStats as getFeedstockStatsData,
  getFeedstockOptions as getFeedstockOptionsData,
  isFeedstockCodeAvailable as isFeedstockCodeAvailableData,
  updateFeedstock,
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
import { resolveDistanceSource } from "@/schemas/distance-source";
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

export async function getFeedstockOptionsFn(): Promise<
  ActionResult<Array<{ id: string; code: string; massDryKg: number; feedstockTypeName: string | null }>>
> {
  try {
    const ctx = await requireOrgContext();

    const data = await getFeedstockOptionsData(ctx);
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: feedstockActionError(
        error,
        "Failed to load feedstock options",
        "feedstock:options",
      ),
    };
  }
}

export async function checkFeedstockCodeFn(
  code: string,
  excludeId?: string
): Promise<ActionResult<boolean>> {
  try {
    const ctx = await requireOrgContext();

    const available = await isFeedstockCodeAvailableData(ctx, code, excludeId);
    return { success: true, data: available };
  } catch (error) {
    return {
      success: false,
      error: feedstockActionError(
        error,
        "Failed to check code",
        "feedstock:check-code",
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
  try {
    const ctx = await requireOrgContext();

    const data = createFeedstockSchema.parse(input);

    // Generate sequential codes for each allocation in one batch
    const codesFn = (count: number) =>
      generateNextCodes(ctx, "FS", feedstocksTable, feedstocksTable.code, count);

    const result = await createFeedstock(
      ctx,
      {
        ...data,
        transportDistanceSource: resolveDistanceSource(
          data.transportDistanceKm,
          data.transportDistanceSource,
        ),
      },
      codesFn,
    );

    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    return {
      success: false,
      error: feedstockActionError(
        error,
        "Failed to create feedstock",
        "feedstock:create",
      ),
    };
  }
}

// ============================================
// Update Operation
// ============================================

export async function updateFeedstockFn(
  input: z.infer<typeof updateFeedstockSchema>
): Promise<ActionResult<FeedstockWithRelations>> {
  try {
    const ctx = await requireOrgContext();

    const {
      feedstockId,
      transportDistanceKm,
      transportDistanceSource,
      transportTripType,
      ...updateData
    } = updateFeedstockSchema.parse(input);
    const data = await updateFeedstock(ctx, feedstockId, {
      ...updateData,
      transportDistanceKm,
      transportDistanceSource: resolveDistanceSource(
        transportDistanceKm,
        transportDistanceSource,
      ),
      transportTripType,
    });

    return { success: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    return {
      success: false,
      error: feedstockActionError(
        error,
        "Failed to update feedstock",
        "feedstock:update",
      ),
    };
  }
}

// ============================================
// Delete Operation
// ============================================

export async function deleteFeedstockFn(
  input: z.infer<typeof deleteFeedstockSchema>
): Promise<ActionResult<void>> {
  try {
    const ctx = await requireOrgContext();

    const { feedstockId } = deleteFeedstockSchema.parse(input);
    await deleteFeedstock(ctx, feedstockId);

    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    return {
      success: false,
      error: feedstockActionError(
        error,
        "Failed to delete feedstock",
        "feedstock:delete",
      ),
    };
  }
}
