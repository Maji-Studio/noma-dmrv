import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { items, type Item } from "@/db/schema";
import { requireProjectMember } from "./projects";

/**
 * Get all items for a project
 * Requires user to be a project member
 */
export async function getProjectItems(
  projectId: string,
  userId: string
): Promise<Item[]> {
  await requireProjectMember(projectId, userId);

  return db
    .select()
    .from(items)
    .where(eq(items.projectId, projectId))
    .orderBy(desc(items.createdAt));
}

/**
 * Create a new item
 * Requires user to be a project member
 */
export async function createItem(
  projectId: string,
  userId: string,
  data: { title: string; description?: string }
): Promise<Item> {
  await requireProjectMember(projectId, userId);

  const [item] = await db
    .insert(items)
    .values({
      projectId,
      title: data.title,
      description: data.description,
    })
    .returning();

  return item;
}

/**
 * Update an item
 * Requires user to be a member of the item's project
 */
export async function updateItem(
  itemId: string,
  userId: string,
  data: { title?: string; description?: string; status?: string }
): Promise<Item> {
  // Get the item to check project membership
  const [item] = await db.select().from(items).where(eq(items.id, itemId));

  if (!item) {
    throw new Error("Item not found");
  }

  await requireProjectMember(item.projectId, userId);

  const [updatedItem] = await db
    .update(items)
    .set(data)
    .where(eq(items.id, itemId))
    .returning();

  return updatedItem;
}

/**
 * Archive an item (soft delete)
 * Requires user to be a member of the item's project
 */
export async function archiveItem(
  itemId: string,
  userId: string
): Promise<void> {
  // Get the item to check project membership
  const [item] = await db.select().from(items).where(eq(items.id, itemId));

  if (!item) {
    throw new Error("Item not found");
  }

  await requireProjectMember(item.projectId, userId);

  await db
    .update(items)
    .set({ status: "archived" })
    .where(eq(items.id, itemId));
}
