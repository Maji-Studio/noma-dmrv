import type { DashboardAttentionItem, DashboardStationKey } from "@/data-access/dashboard-overview";
import { recordHref, type RecordKind } from "@/lib/record-links";

const STAGES = {
  supplier: "suppliers",
  feedstock: "feedstock",
  productionRun: "production",
  biocharProduct: "products",
  delivery: "deliveries",
  application: "applications",
  creditBatch: "production",
  removal: "production",
} satisfies Partial<Record<RecordKind, DashboardStationKey>>;

/** Mirrors the server's single-record shape and uses the canonical link builder. */
export function attentionRow(
  recordKind: keyof typeof STAGES,
  recordId: string,
  overrides: Partial<DashboardAttentionItem> = {},
): DashboardAttentionItem {
  return {
    id: `${recordKind}-${recordId}`,
    stage: STAGES[recordKind],
    recordKind,
    recordIds: [recordId],
    entityCode: recordId,
    date: null,
    title: "Missing data",
    href: recordHref(recordKind, recordId, { facilityId: "f1" }),
    ...overrides,
  };
}
