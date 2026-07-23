export const creditBatchKeys = {
  all: ["creditBatches"] as const,
  lists: () => [...creditBatchKeys.all, "list"] as const,
  list: (filters?: Record<string, unknown>) =>
    [...creditBatchKeys.lists(), filters] as const,
  details: () => [...creditBatchKeys.all, "detail"] as const,
  detail: (id: string) => [...creditBatchKeys.details(), id] as const,
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
