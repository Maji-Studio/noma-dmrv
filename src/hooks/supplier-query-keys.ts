import type { SupplierFilterData } from "@/schemas/suppliers";

export const supplierKeys = {
  all: ["suppliers"] as const,
  lists: () => [...supplierKeys.all, "list"] as const,
  list: (filters?: Partial<SupplierFilterData>) =>
    [...supplierKeys.lists(), filters] as const,
  details: () => [...supplierKeys.all, "detail"] as const,
  detail: (id: string) => [...supplierKeys.details(), id] as const,
  locations: () => [...supplierKeys.all, "locations"] as const,
  supplierLocations: (supplierId: string) =>
    [...supplierKeys.all, "supplierLocations", supplierId] as const,
  options: () => [...supplierKeys.all, "options"] as const,
  codeCheck: (code: string, excludeId?: string) =>
    [...supplierKeys.all, "codeCheck", code, excludeId] as const,
};
