import type { CustomerFilterData } from "@/schemas/customers";

export const customerKeys = {
  all: ["customers"] as const,
  lists: () => [...customerKeys.all, "list"] as const,
  list: (filters?: Partial<CustomerFilterData>) =>
    [...customerKeys.lists(), filters] as const,
  details: () => [...customerKeys.all, "detail"] as const,
  detail: (id: string) => [...customerKeys.details(), id] as const,
  detailWithRelations: (id: string) =>
    [...customerKeys.details(), id, "relations"] as const,
  locations: (id: string) => [...customerKeys.all, id, "locations"] as const,
  /** The dry run behind the delete confirmation; the version pins it to the row the dialog opened on. */
  deletePreview: (id: string, version: number) =>
    [...customerKeys.all, id, "delete-preview", version] as const,
  codeCheck: (code: string, excludeId?: string) =>
    [...customerKeys.all, "codeCheck", code, excludeId] as const,
};
