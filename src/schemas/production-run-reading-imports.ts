import { z } from "zod";

/**
 * Import readings from an uploaded canonical CSV (issue #207). Columns are
 * matched by header (see `@/lib/production-readings/readings-csv`), so no
 * client-supplied column mapping is needed.
 */
export const importProductionRunReadingsSchema = z.object({
  documentId: z.uuid("Invalid document ID"),
});

export type ImportProductionRunReadingsInput = z.infer<
  typeof importProductionRunReadingsSchema
>;
