import { z } from "zod";
import { uuidSchema, expectedVersionSchema } from "./helpers";
import { MAX_ENTRY_TEXT_LENGTH } from "./emission-entries";

export const setEmissionLineCommentSchema = z.object({
  facilityId: uuidSchema().optional(),
  creditBatchId: uuidSchema(),
  componentId: z.string().min(1),
  body: z.string().trim().min(1, "Enter a comment.").max(MAX_ENTRY_TEXT_LENGTH),
  // Omit only when creating. An existing comment always requires its loaded version.
  expectedVersion: expectedVersionSchema.optional(),
});
export const deleteEmissionLineCommentSchema = z.object({
  facilityId: uuidSchema().optional(),
  id: uuidSchema(),
  expectedVersion: expectedVersionSchema,
});
export const setEmissionLineCommentActionSchema = setEmissionLineCommentSchema.required({ facilityId: true });
export const deleteEmissionLineCommentActionSchema = deleteEmissionLineCommentSchema.required({ facilityId: true });
export type SetEmissionLineCommentInput = z.infer<typeof setEmissionLineCommentSchema>;
export type DeleteEmissionLineCommentInput = z.infer<typeof deleteEmissionLineCommentSchema>;
