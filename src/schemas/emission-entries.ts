import { z } from "zod";
import { uuidSchema, expectedVersionSchema } from "@/schemas/helpers";
import { ENTRY_DECIMAL_PATTERN } from "@/lib/certification/emission-entry-rules";
import type { QuantityKind } from "@/lib/isometric/template-observations/types";

const MAX_ENTRY_TEXT_LENGTH = 4000;
const MAX_ENTRY_INPUTS = 2;
const MAX_MAGNITUDE_LENGTH = 100;
const magnitude = z
  .string()
  .max(MAX_MAGNITUDE_LENGTH)
  .regex(ENTRY_DECIMAL_PATTERN, "Enter a non-negative decimal value.");
const quantity = z.object({ magnitude, unit: z.string().min(1) });
export const emissionEntryValueSchema = z.object({
  inputKey: z.string().min(1),
  quantityKind: z.custom<QuantityKind>((value) => typeof value === "string"),
  magnitude,
  unit: z.string().min(1),
  massDistanceDetail: z.object({ mass: quantity, distance: quantity }).nullable().optional(),
});
const fields = {
  occurredOn: z.iso.date(),
  note: z.string().max(MAX_ENTRY_TEXT_LENGTH).nullable().optional(),
  values: z.array(emissionEntryValueSchema).min(1).max(MAX_ENTRY_INPUTS),
};
export const createEmissionEntrySchema = z.object({
  creditBatchId: uuidSchema(),
  componentId: z.string().min(1),
  ...fields,
  occurredOn: fields.occurredOn.optional(),
});
export const emissionEntryVersionSchema = z.object({
  id: uuidSchema(),
  expectedVersion: expectedVersionSchema,
});
export type RestoreEmissionEntryInput = z.infer<typeof emissionEntryVersionSchema>;
export const updateEmissionEntrySchema = emissionEntryVersionSchema.extend({
  occurredOn: fields.occurredOn.optional(),
  note: fields.note,
  values: fields.values.optional(),
});
export const replaceEmissionEntrySchema = emissionEntryVersionSchema.extend({
  occurredOn: fields.occurredOn.optional(),
  note: fields.note,
  values: fields.values,
});
export type ReplaceEmissionEntryInput = z.infer<typeof replaceEmissionEntrySchema>;
export type CreateEmissionEntryInput = z.infer<typeof createEmissionEntrySchema>;
export type UpdateEmissionEntryInput = z.infer<typeof updateEmissionEntrySchema>;
