import type { ProductionRunCreditBatchPreviewInput } from "@/schemas/production-run-credit-batch-preview";
import type { RecordCreditBatchPreviewInput, RecordCreditBatchesInput } from "@/schemas/record-credit-batches";

export const creditBatchKeys = {
  emissionsOverview: (facilityId: string) => ["creditBatches", "emissionsOverview", facilityId] as const,
  emissionLines: (facilityId: string, creditBatchId: string) => ["creditBatches", "emissionLines", facilityId, creditBatchId] as const,
  all: ["creditBatches"] as const,
  recordPrefix: () => [...creditBatchKeys.all, "record"] as const,
  record: (kind: RecordCreditBatchesInput["kind"], id?: string | null) =>
    [...creditBatchKeys.recordPrefix(), kind, id ?? null] as const,
  recordPreviewPrefix: () => [...creditBatchKeys.all, "recordPreview"] as const,
  recordPreview: (input: RecordCreditBatchPreviewInput | null) =>
    [...creditBatchKeys.recordPreviewPrefix(), input] as const,
  runPreviewPrefix: () => [...creditBatchKeys.all, "runPreview"] as const,
  runPreview: (input: ProductionRunCreditBatchPreviewInput | null) =>
    [...creditBatchKeys.runPreviewPrefix(), input] as const,
  lists: () => [...creditBatchKeys.all, "list"] as const,
  list: (filters?: Record<string, unknown>) =>
    [...creditBatchKeys.lists(), filters] as const,
  // List invalidations after create and delete also refresh the next code.
  nextCode: () => [...creditBatchKeys.lists(), "nextCode"] as const,
  details: () => [...creditBatchKeys.all, "detail"] as const,
  detail: (id: string) => [...creditBatchKeys.details(), id] as const,
  pageModel: (id: string) => [...creditBatchKeys.detail(id), "pageModel"] as const,
  timelineFactsPrefix: () => [...creditBatchKeys.all, "timelineFacts"] as const,
  timelineFacts: (facilityId: string, ids: string[]) =>
    [...creditBatchKeys.timelineFactsPrefix(), facilityId, ids] as const,
  previewsPrefix: () => [...creditBatchKeys.all, "previews"] as const,
  previews: (ids: string[]) => [...creditBatchKeys.previewsPrefix(), ids] as const,
  productionRunOptionsPrefix: () =>
    [...creditBatchKeys.all, "productionRunOptions"] as const,
  productionRunOptions: (
    facilityId?: string,
    startDate?: string,
    endDate?: string,
    includeCreditBatchId?: string,
  ) =>
    [
      ...creditBatchKeys.productionRunOptionsPrefix(),
      facilityId,
      startDate,
      endDate,
      includeCreditBatchId,
    ] as const,
};
