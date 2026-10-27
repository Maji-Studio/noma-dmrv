import { z } from "zod";

/** Frozen carry facts shared by semantic snapshot writers and sheet readers. */
export const carriedEntrySnapshotSchema = z.object({
  entryId: z.string(), creditBatchId: z.string(), componentId: z.string(),
  occurredOn: z.string(), value: z.object({ magnitude: z.string(), unit: z.string() }),
  evidenceDocumentIds: z.array(z.string()), earlierRemovalId: z.string().optional(),
});
export type CarriedEntrySnapshot = z.infer<typeof carriedEntrySnapshotSchema>;
