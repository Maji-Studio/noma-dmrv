import { z } from "zod";

/**
 * Schema for item form (client-side validation)
 * Used in ItemForm component for creating/editing items
 */
export const itemFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(255, "Title must be less than 255 characters"),
  description: z.string().max(1000, "Description must be less than 1000 characters").optional().or(z.literal("")),
});

/**
 * Schema for creating an item (server action)
 * Extends form schema with projectId
 */
export const createItemSchema = itemFormSchema.extend({
  projectId: z.string().uuid(),
});

/**
 * Schema for updating an item (server action)
 * All fields optional except itemId
 */
export const updateItemSchema = z.object({
  itemId: z.string().uuid(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

/**
 * Type inference for item form data
 */
export type ItemFormData = z.infer<typeof itemFormSchema>;
