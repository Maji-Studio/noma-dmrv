import { z } from "zod";
import { uuidSchema } from "./helpers";

export const loadRemovalTemplateReviewSchema = z.uuid();
const removalTemplateIdSchema = z.string().trim().min(1, "Choose a Removal template.");

export const removalTemplateReviewPreviewSchema = z.object({
  facilityId: uuidSchema(),
  removalTemplateId: removalTemplateIdSchema,
});
export type RemovalTemplateReviewPreviewInput = z.infer<typeof removalTemplateReviewPreviewSchema>;
