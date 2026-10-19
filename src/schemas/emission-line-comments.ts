import { z } from "zod";
import { uuidSchema, expectedVersionSchema } from "./helpers";
import { MAX_ENTRY_TEXT_LENGTH } from "./emission-entries";

export const setEmissionLineCommentSchema = z.object({
  facilityId: uuidSchema().optional(),
  creditBatchId: uuidSchema(),
  componentId: z.string().min(1),
  body: z.string().trim().min(1, "Enter a comment.").max(MAX_ENTRY_TEXT_LENGTH),
  // Omit both only when creating. An edit names the loaded comment and its version,
  // so a stale edit cannot overwrite a comment that replaced a deleted one.
  id: uuidSchema().optional(),
  expectedVersion: expectedVersionSchema.optional(),
}).refine((input) => (input.id === undefined) === (input.expectedVersion === undefined), {
  message: "An edit needs the comment and its version.", path: ["expectedVersion"],
});
export const deleteEmissionLineCommentSchema = z.object({
  facilityId: uuidSchema().optional(),
  id: uuidSchema(),
  expectedVersion: expectedVersionSchema,
});
export const setEmissionLineCommentActionSchema = setEmissionLineCommentSchema.safeExtend({ facilityId: uuidSchema() });
export const deleteEmissionLineCommentActionSchema = deleteEmissionLineCommentSchema.required({ facilityId: true });
export type SetEmissionLineCommentInput = z.infer<typeof setEmissionLineCommentSchema>;
export type DeleteEmissionLineCommentInput = z.infer<typeof deleteEmissionLineCommentSchema>;
