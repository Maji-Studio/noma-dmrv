import { z } from "zod";

export const startRemovalTemplateSetupSchema = z.object({
  facilityId: z.uuid(),
  removalTemplateId: z.string().trim().min(1, "Choose a Removal template."),
});

/** The default only decides which template new credit batches start on; nothing is sent to Isometric. */
export const setFacilityDefaultRemovalTemplateSchema = startRemovalTemplateSetupSchema;

export type StartRemovalTemplateSetupInput = z.infer<typeof startRemovalTemplateSetupSchema>;
export type SetFacilityDefaultRemovalTemplateInput = z.infer<typeof setFacilityDefaultRemovalTemplateSchema>;

export const loadRemovalTemplateSetupSchema = z.uuid();
export const applyRemovalTemplateSetupSchema = startRemovalTemplateSetupSchema.extend({
  fingerprints: z.object({ semanticFingerprint: z.string().min(1), fullFingerprint: z.string().min(1) }),
  answers: z.record(z.string().min(1), z.string().min(1)),
  overrides: z.record(z.string().min(1), z.string().min(1)),
  makeDefault: z.boolean(),
  batches: z.array(z.object({ id: z.uuid(), expectedVersion: z.number().int().positive() }))
    .refine((batches) => new Set(batches.map((batch) => batch.id)).size === batches.length, "Choose each credit batch once."),
});
export type ApplyRemovalTemplateSetupInput = z.infer<typeof applyRemovalTemplateSetupSchema>;
