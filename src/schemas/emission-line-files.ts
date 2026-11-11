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
