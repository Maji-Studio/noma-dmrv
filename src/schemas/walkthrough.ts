import { z } from "zod";
import { WALKTHROUGH_FIELD_LIMITS as LIMITS } from "@/config/walkthrough";

export const walkthroughSchema = z.object({
  name: z.string().trim().min(LIMITS.requiredMin).max(LIMITS.name),
  email: z.email().max(LIMITS.email),
  company: z.string().trim().min(LIMITS.requiredMin).max(LIMITS.company),
  size: z.string().trim().min(LIMITS.requiredMin).max(LIMITS.size),
  message: z.string().trim().max(LIMITS.message).optional().transform(value => value || undefined),
  website: z.string().optional(),
});

export type WalkthroughInput = z.infer<typeof walkthroughSchema>;
