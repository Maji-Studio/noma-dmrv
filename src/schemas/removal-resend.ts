import { z } from "zod";
import { uuidSchema } from "./helpers";

export const removalResendSchema = z.object({
  facilityId: uuidSchema(),
  removalId: uuidSchema(),
});
export type RemovalResendInput = z.infer<typeof removalResendSchema>;
