import { z } from "zod";

export const reactorDayCsvMappingSchema = z.object({
  temperature: z.string().min(1, "Select a temperature column"),
  pressure: z.string().min(1, "Select a pressure column"),
  gasFlow: z.string().min(1).nullable().optional(),
});

export const previewProductionRunReadingsImportSchema = z.object({
  documentId: z.string().uuid("Invalid document ID"),
});

export const importProductionRunReadingsSchema = z.object({
  documentId: z.string().uuid("Invalid document ID"),
  mapping: reactorDayCsvMappingSchema.optional(),
});

export type ReactorDayCsvMappingInput = z.infer<
  typeof reactorDayCsvMappingSchema
>;
