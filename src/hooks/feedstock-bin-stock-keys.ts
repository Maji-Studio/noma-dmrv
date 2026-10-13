export const feedstockBinStockKeys = {
  all: ["feedstockBinStock"] as const,
  detail: (storageLocationId: string) => [...feedstockBinStockKeys.all, storageLocationId] as const,
};
