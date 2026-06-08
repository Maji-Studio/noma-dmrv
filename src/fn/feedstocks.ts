"use server";

/**
 * Feedstock Server Actions
 * Unified server-side functions for the combined delivery + bin allocation workflow.
 */

import { z } from "zod";
import { feedstocks as feedstocksTable } from "@/db/schema";
import { generateNextCodes } from "@/data-access/code-generator";
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
import { getUser } from "@/lib/auth/server";
import {
  createFeedstockSchema,
  deleteFeedstockSchema,
  updateFeedstockSchema,
  feedstockFilterSchema,
} from "@/schemas/feedstocks";
import type { ActionResult } from "@/types/actions";

// ============================================
// List/Query Operations
// ============================================

export async function getFeedstocksFn(
  filters?: Partial<z.infer<typeof feedstockFilterSchema>>
): Promise<ActionResult<PaginatedFeedstocks>> {
  try {
    const user = await getUser();
    if (!user?.id) return { success: false, error: "Unauthorized" };

    const validatedFilters = filters
      ? feedstockFilterSchema.parse(filters)
      : undefined;
    const data = await getFeedstocksData(user.id, validatedFilters);

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
      error: error instanceof Error ? error.message : "Failed to load feedstocks",
    };
  }
}

export async function getFeedstockByIdFn(
  feedstockId: string
): Promise<ActionResult<FeedstockWithRelations>> {
  try {
    const user = await getUser();
    if (!user?.id) return { success: false, error: "Unauthorized" };

    const data = await getFeedstockByIdData(user.id, feedstockId);
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load feedstock",
    };
  }
}

export async function getFeedstockStatsFn(
  facilityId?: string
): Promise<ActionResult<FeedstockStats>> {
  try {
    const user = await getUser();
    if (!user?.id) return { success: false, error: "Unauthorized" };

    const data = await getFeedstockStatsData(user.id, facilityId);
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load feedstock stats",
    };
  }
}

export async function getFeedstockOptionsFn(): Promise<
  ActionResult<Array<{ id: string; code: string; massDryKg: number; feedstockTypeName: string | null }>>
> {
  try {
    const user = await getUser();
    if (!user?.id) return { success: false, error: "Unauthorized" };

    const data = await getFeedstockOptionsData(user.id);
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load feedstock options",
    };
  }
}

export async function checkFeedstockCodeFn(
  code: string,
  excludeId?: string
): Promise<ActionResult<boolean>> {
  try {
    const user = await getUser();
    if (!user?.id) return { success: false, error: "Unauthorized" };

    const available = await isFeedstockCodeAvailableData(user.id, code, excludeId);
    return { success: true, data: available };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to check code",
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
    const user = await getUser();
    if (!user?.id) return { success: false, error: "Unauthorized" };

    const data = createFeedstockSchema.parse(input);

    // Generate sequential codes for each allocation in one batch
    const codesFn = (count: number) =>
      generateNextCodes("FS", feedstocksTable, feedstocksTable.code, count);

    const result = await createFeedstock(user.id, data, codesFn);

    // Auto-derive the transport leg for each created feedstock (split deliveries
    // produce one feedstock row per bin; each gets its own leg, mass-weighted).
    await Promise.all(
      result.feedstocks.map((feedstock) =>
        syncFeedstockTransportLeg(
          user.id,
          feedstock.id,
          data.transportDistanceKm,
        ),
      ),
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
      error: error instanceof Error ? error.message : "Failed to create feedstock",
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
    const user = await getUser();
    if (!user?.id) return { success: false, error: "Unauthorized" };

    // transportDistanceKm is not a feedstock column — it drives the derived
    // transport leg, so strip it before the feedstock update spread.
    const { feedstockId, transportDistanceKm, ...updateData } =
      updateFeedstockSchema.parse(input);
    const data = await updateFeedstock(user.id, feedstockId, updateData);

    await syncFeedstockTransportLeg(user.id, feedstockId, transportDistanceKm);

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
      error: error instanceof Error ? error.message : "Failed to update feedstock",
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
    const user = await getUser();
    if (!user?.id) return { success: false, error: "Unauthorized" };

    const { feedstockId } = deleteFeedstockSchema.parse(input);
    await deleteFeedstock(user.id, feedstockId);

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
      error: error instanceof Error ? error.message : "Failed to delete feedstock",
    };
  }
}
