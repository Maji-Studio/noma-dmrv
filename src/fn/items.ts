"use server";

import { z } from "zod";
import type { ActionResult } from "@/types/actions";
import type { Item } from "@/db/schema";
import { getUser } from "@/lib/auth/server";
import {
  createItem,
  updateItem,
  archiveItem,
  getProjectItems as getProjectItemsData,
} from "@/data-access/items";
import {
  createItemSchema,
  updateItemSchema,
} from "@/schemas/items";

/**
 * Create a new item
 */
export async function createItemFn(
  data: z.infer<typeof createItemSchema>
): Promise<ActionResult<Item>> {
  try {
    const user = await getUser();
    if (!user || !user.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = createItemSchema.parse(data);

    const item = await createItem(validated.projectId, user.id, {
      title: validated.title,
      description: validated.description,
    });

    return { success: true, data: item };
  } catch (error) {
    console.error("Failed to create item:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create item",
    };
  }
}

/**
 * Update an item
 */
export async function updateItemFn(
  data: z.infer<typeof updateItemSchema>
): Promise<ActionResult<Item>> {
  try {
    const user = await getUser();
    if (!user || !user.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = updateItemSchema.parse(data);

    const item = await updateItem(validated.itemId, user.id, {
      title: validated.title,
      description: validated.description,
      status: validated.status,
    });

    return { success: true, data: item };
  } catch (error) {
    console.error("Failed to update item:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update item",
    };
  }
}

/**
 * Archive an item
 */
export async function archiveItemFn(
  itemId: string
): Promise<ActionResult<void>> {
  try {
    const user = await getUser();
    if (!user || !user.id) {
      return { success: false, error: "Unauthorized" };
    }

    await archiveItem(itemId, user.id);

    return { success: true, data: undefined };
  } catch (error) {
    console.error("Failed to archive item:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to archive item",
    };
  }
}

/**
 * Get project items
 */
export async function getProjectItems(
  projectId: string
): Promise<ActionResult<Item[]>> {
  try {
    const user = await getUser();
    if (!user || !user.id) {
      return { success: false, error: "Unauthorized" };
    }

    const items = await getProjectItemsData(projectId, user.id);

    return { success: true, data: items };
  } catch (error) {
    console.error("Failed to get items:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to get items",
    };
  }
}
