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
  syncFeedstockTransportLeg,
  type PaginatedFeedstocks,
  type FeedstockWithRelations,
  type FeedstockStats,
  type CreateFeedstockResult,
} from "@/data-access/feedstocks";
import { requireOrgContext, type OrgContext } from "@/lib/auth/server";
import { logger } from "@/lib/log";
import {
  createFeedstockSchema,
  deleteFeedstockSchema,
  updateFeedstockSchema,
  feedstockFilterSchema,
} from "@/schemas/feedstocks";
import { resolveDistanceSource } from "@/schemas/distance-source";
import type { ActionResult } from "@/types/actions";
import { toLoggedActionError } from "./action-errors";

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

// The leg sync runs AFTER the feedstock write has committed, so a failure here
// must not surface as a failed mutation — the UI would invite a retry of a
// create that already happened (duplicate codes). Mirrors resyncBiocharLegs in
// fn/deliveries.ts, with one difference: the form's distance override is NOT
// persisted on the feedstock row, so a swallowed failure loses it until the
// next edit — log the override so the value is recoverable.
async function syncFeedstockLegsBestEffort(
  ctx: OrgContext,
  feedstockIds: string[],
  override: NonNullable<Parameters<typeof syncFeedstockTransportLeg>[2]>,
): Promise<void> {
  const results = await Promise.allSettled(
    feedstockIds.map((id) => syncFeedstockTransportLeg(ctx, id, override)),
  );
  results.forEach((result, index) => {
    if (result.status !== "rejected") return;
    logger.warn(
      {
        userId: ctx.userId,
        feedstockId: feedstockIds[index],
        distanceKmOverride: override.distanceKm ?? null,
        distanceSourceOverride: override.distanceSource ?? null,
        err:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      },
      "feedstock transport leg sync failed after committed write; leg (and any form distance override) stale until next edit",
    );
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
        error: `Invalid filter parameters: ${error.issues.map((e) => e.message).join(", ")}`,
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
  facilityId?: string
): Promise<ActionResult<FeedstockStats>> {
  try {
    const ctx = await requireOrgContext();

    if (facilityId) {
      await requireOrgFacility(ctx, facilityId);
    }
    const data = await getFeedstockStatsData(ctx, facilityId);
    return { success: true, data };
  } catch (error) {
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

    const result = await createFeedstock(ctx, data, codesFn);

    // Auto-derive the transport leg for each created feedstock (split deliveries
    // produce one feedstock row per bin; each gets its own leg, mass-weighted).
    await syncFeedstockLegsBestEffort(
      ctx,
      result.feedstocks.map((feedstock) => feedstock.id),
      {
        distanceKm: data.transportDistanceKm,
        distanceSource: resolveDistanceSource(
          data.transportDistanceKm,
          data.transportDistanceSource,
        ),
        tripType: data.transportTripType ?? undefined,
      },
    );

    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
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

    // transportDistanceKm/-Source are not feedstock columns — they drive the
    // derived transport leg, so strip them before the feedstock update spread.
    const {
      feedstockId,
      transportDistanceKm,
      transportDistanceSource,
      transportTripType,
      ...updateData
    } = updateFeedstockSchema.parse(input);
    const data = await updateFeedstock(ctx, feedstockId, updateData);

    await syncFeedstockLegsBestEffort(ctx, [feedstockId], {
      distanceKm: transportDistanceKm,
      distanceSource: resolveDistanceSource(
        transportDistanceKm,
        transportDistanceSource,
      ),
      tripType: transportTripType ?? undefined,
    });

    return { success: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
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
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
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
