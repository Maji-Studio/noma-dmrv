import { z } from "zod";
import { uuidSchema, expectedVersionSchema } from "./helpers";
import { MAX_ENTRY_TEXT_LENGTH } from "./emission-entries";

export const undoEmissionZerosSchema = z.object({ removalId: uuidSchema(), creditBatchId: uuidSchema(), expectedRemovalVersion: expectedVersionSchema.optional() });
export const recordEmissionZerosSchema = undoEmissionZerosSchema.extend({
  componentIds: z.array(z.string().min(1)).min(1),
  note: z.string().trim().max(MAX_ENTRY_TEXT_LENGTH).nullable().optional().transform((value) => value || null),
});
