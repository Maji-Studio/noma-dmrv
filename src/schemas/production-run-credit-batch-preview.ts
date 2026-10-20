import { z } from "zod";
import { PRODUCTION_RUN_STATUSES } from "@/lib/production-runs/lifecycle";
import { stockEventInstantSchema, uuidSchema } from "./helpers";

/** Bounds the source bins one preview may name, as for run draws. */
export const MAX_PREVIEW_SOURCE_BINS = 200;

/**
 * The unsaved Production Run form values that decide its credit batch. Every
 * field may be missing: the server answers which input is still needed, so
 * the browser never decides membership itself. Instants are resolved from the
 * facility wall clock by the form, as on save.
 */
export const productionRunCreditBatchPreviewSchema = z.object({
  facilityId: uuidSchema().nullable(),
  /** The saved run on edit, so its current membership is read. */
  productionRunId: uuidSchema().nullable(),
  status: z.enum(PRODUCTION_RUN_STATUSES),
  startTime: stockEventInstantSchema().nullable(),
  endTime: stockEventInstantSchema().nullable(),
  /** Feedstock source bins chosen in the draw rows, blanks left out. */
  feedstockStorageLocationIds: z.array(uuidSchema()).max(MAX_PREVIEW_SOURCE_BINS),
});

export type ProductionRunCreditBatchPreviewInput = z.input<typeof productionRunCreditBatchPreviewSchema>;
export type ProductionRunCreditBatchPreviewParsed = z.output<typeof productionRunCreditBatchPreviewSchema>;
