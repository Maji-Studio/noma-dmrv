import { z } from "zod";
import { uuidSchema } from "./helpers";
import { AUTOMATIC_SOURCE_IDS } from "@/lib/isometric/template-observations/catalog-sources";

export const loadRemovalTemplateReviewSchema = z.uuid();
const lineAssignmentSchema = z.object({
  scope: z.enum(["operating", "forbidden", "unassigned"]),
  automaticSource: z.enum(AUTOMATIC_SOURCE_IDS).optional(),
  entryPolicy: z.enum(["none", "additive", "single"]),
});
export const reviewRemovalTemplateLinesSchema = z.object({
  observationId: z.uuid(), expectedVersion: z.number().int().positive(),
  assignments: z.record(z.string().min(1), lineAssignmentSchema),
});
export const switchCreditBatchRemovalTemplateSchema = z.object({
  creditBatchId: z.uuid(), removalTemplateId: z.string().trim().min(1, "Choose a Removal template."), expectedVersion: z.number().int().positive(),
});
/** The switch dialog's one field; the action adds the batch id and version. */
export const switchRemovalTemplateFormSchema = switchCreditBatchRemovalTemplateSchema.pick({ removalTemplateId: true });
/** The line review form: drafts keyed by component id. The card adds the observation and version. */
export const reviewRemovalTemplateLinesFormSchema = reviewRemovalTemplateLinesSchema.pick({ assignments: true });
export type ReviewRemovalTemplateLinesInput = z.infer<typeof reviewRemovalTemplateLinesSchema>;
export type ReviewRemovalTemplateLinesFormValues = z.infer<typeof reviewRemovalTemplateLinesFormSchema>;
export type SwitchCreditBatchRemovalTemplateInput = z.infer<typeof switchCreditBatchRemovalTemplateSchema>;
export type SwitchRemovalTemplateFormValues = z.infer<typeof switchRemovalTemplateFormSchema>;

export const removalTemplateReviewPreviewSchema = z.object({
  facilityId: uuidSchema(),
  removalTemplateId: switchCreditBatchRemovalTemplateSchema.shape.removalTemplateId,
});
export type RemovalTemplateReviewPreviewInput = z.infer<typeof removalTemplateReviewPreviewSchema>;
