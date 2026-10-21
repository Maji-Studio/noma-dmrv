import { z } from "zod";
import { uuidSchema } from "./helpers";

export const loadRemovalTemplateReviewSchema = z.uuid();
export const switchCreditBatchRemovalTemplateSchema = z.object({
  creditBatchId: z.uuid(), removalTemplateId: z.string().trim().min(1, "Choose a Removal template."), expectedVersion: z.number().int().positive(),
});
/** The switch dialog's one field; the action adds the batch id and version. */
export const switchRemovalTemplateFormSchema = switchCreditBatchRemovalTemplateSchema.pick({ removalTemplateId: true });
export type SwitchCreditBatchRemovalTemplateInput = z.infer<typeof switchCreditBatchRemovalTemplateSchema>;
export type SwitchRemovalTemplateFormValues = z.infer<typeof switchRemovalTemplateFormSchema>;

export const removalTemplateReviewPreviewSchema = z.object({
  facilityId: uuidSchema(),
  removalTemplateId: switchCreditBatchRemovalTemplateSchema.shape.removalTemplateId,
});
export type RemovalTemplateReviewPreviewInput = z.infer<typeof removalTemplateReviewPreviewSchema>;
