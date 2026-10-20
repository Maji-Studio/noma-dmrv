import { z } from "zod";

/** Separate from entity values so retry identity never affects the fingerprint. */
export const createIntentOptionsSchema = z.object({ intentKey: z.uuid().optional() }).optional();
export type CreateIntentOptions = z.infer<typeof createIntentOptionsSchema>;
