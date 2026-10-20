import { z } from "zod";
import { uuidSchema } from "@/schemas/helpers";

/** Separate from entity values so retry identity never affects the fingerprint. */
export const createIntentOptionsSchema = z.object({ intentKey: uuidSchema().optional() }).optional();
export type CreateIntentOptions = z.infer<typeof createIntentOptionsSchema>;
