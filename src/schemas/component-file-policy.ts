import { z } from "zod";
import { uuidSchema } from "./helpers";
import { FILE_POLICIES } from "@/lib/isometric/template-observations/file-policies";

export const setComponentFilePolicySchema = z.object({
  observationId: uuidSchema(), componentId: z.string().trim().min(1),
  filePolicy: z.enum(FILE_POLICIES), expectedVersion: z.number().int().positive(),
});
export type SetComponentFilePolicyInput = z.infer<typeof setComponentFilePolicySchema>;
