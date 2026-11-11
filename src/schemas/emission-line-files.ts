import { z } from "zod";
import { requestUploadSchema } from "./documents";

export const emissionLineFileAnchorSchema = z.object({
  creditBatchId: z.uuid(), componentId: z.string().trim().min(1),
});
// Keep upload declaration validation in the shared document schema.
export const attachEmissionLineFileSchema = emissionLineFileAnchorSchema.extend({
  upload: z.object(requestUploadSchema.shape).omit({ entityType: true, entityId: true }),
});
export const removeEmissionLineFileSchema = z.object({
  documentId: z.uuid(), expectedVersion: z.number().int().positive(),
});
export type EmissionLineFileAnchorInput = z.infer<typeof emissionLineFileAnchorSchema>;
export type AttachEmissionLineFileInput = z.infer<typeof attachEmissionLineFileSchema>;
export type RemoveEmissionLineFileInput = z.infer<typeof removeEmissionLineFileSchema>;

/** Versions restart on every new set, so the anchor id names the reviewed set. */
export const replaceEmissionLineFilesSchema = emissionLineFileAnchorSchema.extend({
  anchorId: z.uuid(), expectedVersion: z.number().int().positive(),
});
export type ReplaceEmissionLineFilesInput = z.infer<typeof replaceEmissionLineFilesSchema>;
