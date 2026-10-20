import { z } from "zod";
import { uuidSchema } from "./helpers";

/** Only persisted records have provenance to resolve. */
export const recordCreditBatchesSchema = z.object({
  kind: z.enum(["feedstock", "biochar-product", "delivery", "application"]),
  id: uuidSchema(),
});

export type RecordCreditBatchesInput = z.infer<typeof recordCreditBatchesSchema>;
