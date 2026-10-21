import { z } from "zod";

export const loadRemovalTemplateSetupSchema = z.uuid();
export const applyRemovalTemplateSetupSchema = z.object({
  facilityId: z.uuid(),
  removalTemplateId: z.string().trim().min(1, "Choose a Removal template."),
  fingerprints: z.object({ semanticFingerprint: z.string().min(1), fullFingerprint: z.string().min(1) }),
  planFingerprint: z.string().min(1),
  answers: z.record(z.string().min(1), z.string().min(1)),
  overrides: z.record(z.string().min(1), z.string().min(1)),
  batchVersions: z.array(z.object({ id: z.uuid(), expectedVersion: z.number().int().positive(), removalTemplateId: z.string().nullable() }))
    .refine((batches) => new Set(batches.map((batch) => batch.id)).size === batches.length, "Choose each credit batch once."),
});
export type ApplyRemovalTemplateSetupInput = z.infer<typeof applyRemovalTemplateSetupSchema>;
