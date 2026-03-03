"use server";

/**
 * Feedstocks Server Actions
 * Server-side functions for feedstock CRUD operations
 */

import { z } from "zod";
import { feedstocks as feedstocksTable } from "@/db/schema";
import { withAutoCode } from "@/data-access/code-generator";
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
// Feedstock List/Query Operations
// ============================================

export async function getFeedstocksFn(
  filters?: Partial<z.infer<typeof feedstockFilterSchema>>
): Promise<ActionResult<PaginatedFeedstocks>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

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
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

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
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const stats = await getFeedstockStatsData(user.id, facilityId);
    return { success: true, data: stats };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load feedstock stats",
    };
  }
}

export async function getFeedstockOptionsFn(): Promise<
  ActionResult<
    Array<{ id: string; code: string; massDryKg: number; feedstockTypeName: string | null }>
  >
> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const options = await getFeedstockOptionsData(user.id);
    return { success: true, data: options };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load feedstock options",
    };
  }
}

export async function checkFeedstockCodeFn(
  code: string,
  excludeFeedstockId?: string
): Promise<ActionResult<{ available: boolean }>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const available = await isFeedstockCodeAvailableData(
      user.id,
      code,
      excludeFeedstockId
    );
    return { success: true, data: { available } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to check feedstock code",
    };
  }
}

// ============================================
// Feedstock Create Operations
// ============================================

export async function createFeedstockFn(
  data: z.infer<typeof createFeedstockSchema>
): Promise<ActionResult<FeedstockWithRelations>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = createFeedstockSchema.parse(data);

    const feedstock = await withAutoCode(
      "FS",
      feedstocksTable,
      feedstocksTable.code,
      undefined,
      (code) =>
        createFeedstock(user.id, {
          code,
          facilityId: validated.facilityId,
          feedstockDeliveryId: validated.feedstockDeliveryId,
          feedstockTypeId: validated.feedstockTypeId,
          massDryKg: typeof validated.massDryKg === "number" ? validated.massDryKg : 0,
          massWetKg: validated.massWetKg ?? null,
          moistureContentPercent: validated.moistureContentPercent ?? null,
          storageLocationId: validated.storageLocationId || null,
          feedstockSourceRegion: validated.feedstockSourceRegion || null,
          notes: validated.notes || null,
        })
    );

    return { success: true, data: feedstock };
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
// Feedstock Update Operations
// ============================================

export async function updateFeedstockFn(
  data: z.infer<typeof updateFeedstockSchema>
): Promise<ActionResult<FeedstockWithRelations>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = updateFeedstockSchema.parse(data);

    const feedstock = await updateFeedstock(user.id, validated.feedstockId, {
      feedstockDeliveryId: validated.feedstockDeliveryId,
      feedstockTypeId: validated.feedstockTypeId,
      facilityId: validated.facilityId,
      massDryKg: validated.massDryKg,
      massWetKg: validated.massWetKg,
      moistureContentPercent: validated.moistureContentPercent,
      storageLocationId: validated.storageLocationId,
      feedstockSourceRegion: validated.feedstockSourceRegion,
      notes: validated.notes,
    });

    return { success: true, data: feedstock };
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
// Feedstock Delete Operations
// ============================================

export async function deleteFeedstockFn(
  data: z.infer<typeof deleteFeedstockSchema>
): Promise<ActionResult<void>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = deleteFeedstockSchema.parse(data);
    await deleteFeedstock(user.id, validated.feedstockId);

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
