import { z } from "zod";

export const startRemovalTemplateSetupSchema = z.object({
  facilityId: z.uuid(),
  removalTemplateId: z.string().trim().min(1, "Choose a Removal template."),
});

/** The default only decides which template new credit batches start on; nothing is sent to Isometric. */
export const setFacilityDefaultRemovalTemplateSchema = startRemovalTemplateSetupSchema;

export type StartRemovalTemplateSetupInput = z.infer<typeof startRemovalTemplateSetupSchema>;
export type SetFacilityDefaultRemovalTemplateInput = z.infer<typeof setFacilityDefaultRemovalTemplateSchema>;
