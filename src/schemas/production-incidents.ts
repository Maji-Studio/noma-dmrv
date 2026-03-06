/**
 * Production Incident validation schemas
 * Zod schemas for inline production incident CRUD within a production run
 */

import { z } from "zod";
import { emptyToNull } from "./helpers";

export const productionIncidentSeverities = ["low", "medium", "high"] as const;

export type ProductionIncidentSeverity = (typeof productionIncidentSeverities)[number];

export function formatProductionIncidentSeverity(severity: ProductionIncidentSeverity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

export const productionIncidentFormSchema = z.object({
  productionRunId: z
    .string()
    .min(1, "Please select a production run")
    .uuid("Please select a valid production run"),
  incidentTime: z.union([
    z.date(),
    z.string().min(1, "Please enter an incident time").transform((val, ctx) => {
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(val)) return val;
      const date = new Date(val);
      if (isNaN(date.getTime())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid incident time",
        });
        return z.NEVER;
      }
      return date;
    }),
  ]),
  operatorId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  reactorId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  severity: z.enum(productionIncidentSeverities),
  description: z
    .string()
    .trim()
    .min(1, "Please enter an incident description")
    .max(4000, "Description must be less than 4000 characters"),
  correctiveActions: z
    .string()
    .trim()
    .max(4000, "Corrective actions must be less than 4000 characters")
    .optional()
    .nullable()
    .or(z.literal("")),
  notes: z
    .string()
    .trim()
    .max(4000, "Notes must be less than 4000 characters")
    .optional()
    .nullable()
    .or(z.literal("")),
});

export const createProductionIncidentSchema = productionIncidentFormSchema;

export const updateProductionIncidentSchema = productionIncidentFormSchema.extend({
  productionIncidentId: z.string().uuid("Invalid production incident ID"),
});

export const deleteProductionIncidentSchema = z.object({
  productionIncidentId: z.string().uuid("Invalid production incident ID"),
});

export type ProductionIncidentFormData = z.infer<typeof productionIncidentFormSchema>;
export type CreateProductionIncidentData = z.infer<typeof createProductionIncidentSchema>;
export type UpdateProductionIncidentData = z.infer<typeof updateProductionIncidentSchema>;
export type DeleteProductionIncidentData = z.infer<typeof deleteProductionIncidentSchema>;
