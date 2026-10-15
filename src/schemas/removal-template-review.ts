import { z } from "zod";
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
  creditBatchId: z.uuid(), removalTemplateId: z.string().trim().min(1), expectedVersion: z.number().int().positive(),
});
export type ReviewRemovalTemplateLinesInput = z.infer<typeof reviewRemovalTemplateLinesSchema>;
export type SwitchCreditBatchRemovalTemplateInput = z.infer<typeof switchCreditBatchRemovalTemplateSchema>;
