import { z } from "zod";
import { API_PRODUCTION_RUN_MAX_DRAWS } from "@/config/api-rest";
import { PRODUCTION_RUN_STATUSES } from "@/lib/production-runs/lifecycle";
import { stockEventInstantSchema, uuidSchema } from "./helpers";


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
  /** Feedstock source bins chosen in the draw rows, blanks left out; bounded like the run's draws. */
  feedstockStorageLocationIds: z.array(uuidSchema()).max(API_PRODUCTION_RUN_MAX_DRAWS),
});

export type ProductionRunCreditBatchPreviewInput = z.input<typeof productionRunCreditBatchPreviewSchema>;
export type ProductionRunCreditBatchPreviewParsed = z.output<typeof productionRunCreditBatchPreviewSchema>;
