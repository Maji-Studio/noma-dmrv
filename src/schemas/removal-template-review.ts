import { z } from "zod";
import { uuidSchema } from "./helpers";

export const loadRemovalTemplateReviewSchema = z.uuid();
const removalTemplateIdSchema = z.string().trim().min(1, "Choose a Removal template.");
/** Retained for the retiring switch dialog until its UI is removed. */
export const switchRemovalTemplateFormSchema = z.object({ removalTemplateId: removalTemplateIdSchema });
export type SwitchRemovalTemplateFormValues = z.infer<typeof switchRemovalTemplateFormSchema>;

export const removalTemplateReviewPreviewSchema = z.object({
  facilityId: uuidSchema(),
  removalTemplateId: removalTemplateIdSchema,
});
export type RemovalTemplateReviewPreviewInput = z.infer<typeof removalTemplateReviewPreviewSchema>;
