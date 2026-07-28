/**
 * Operator Validation Schemas
 * Zod schemas for operator CRUD operations
 */

import { z } from "zod";

// ============================================
// Operator Form Schema (Client-side validation)
// ============================================

export const operatorFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Operator name is required")
    .max(255, "Operator name must be less than 255 characters"),
  credentials: z
    .string()
    .max(255, "Credentials must be less than 255 characters")
    .optional()
    .nullable()
    .or(z.literal("")),
  contactPhone: z
    .string()
    .max(30, "Phone number must be less than 30 characters")
    .optional()
    .nullable()
    .or(z.literal("")),
});

// ============================================
// Server Action Schemas
// ============================================

export const createOperatorSchema = operatorFormSchema;

export const updateOperatorSchema = z.object({
  operatorId: z.string().uuid("Choose a valid operator."),
  name: z.string().trim().min(1).max(255).optional(),
  credentials: z.string().max(255).optional().nullable(),
  contactPhone: z.string().max(30).optional().nullable(),
});

export const deleteOperatorSchema = z.object({
  operatorId: z.string().uuid("Choose a valid operator."),
});

// ============================================
// Type Inference
// ============================================

export type OperatorFormData = z.infer<typeof operatorFormSchema>;
export type CreateOperatorData = z.infer<typeof createOperatorSchema>;
export type UpdateOperatorData = z.infer<typeof updateOperatorSchema>;
export type DeleteOperatorData = z.infer<typeof deleteOperatorSchema>;
