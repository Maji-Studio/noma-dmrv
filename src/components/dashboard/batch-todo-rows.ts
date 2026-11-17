/**
 * The To do rows for credit batches: one per active batch whose page shows
 * open to-dos (Blocking + Check, the Overview badge). Waiting items never
 * count. Batches with blocking items come first, then by code.
 */
import type { CreditBatchHealthSummary } from "@/fn/certification";
import { facilityListHref } from "@/lib/dashboard-links";
import { todosLabel } from "@/lib/credit-batches/batch-page";
import { recordHref } from "@/lib/record-links";
import type { DashboardAttentionItem } from "@/data-access/dashboard-overview";
import { scopeAttentionItems } from "./batch-scope";

interface TodoBatch {
  id: string;
  code: string;
  name?: string | null;
  facilityId: string;
}

type TodoCounts = Pick<CreditBatchHealthSummary, "issueCount" | "checkCount">;

/** The row a failed read adds, so an unchecked panel never reads as all clear. */
export const BATCH_TODOS_FAILED_TITLE = "Couldn't check credit batch to-dos";

export function batchTodoRows(
  batches: readonly TodoBatch[],
  summaries: Readonly<Record<string, TodoCounts | undefined>>,
  selectedBatchId: string | null,
  /** A read failed: keep the rows that loaded and say the check is incomplete. */
  failure: { facilityId: string } | null = null,
): DashboardAttentionItem[] {
  const rows = batches
    .flatMap((batch) => {
      const summary = summaries[batch.id];
      const blocking = summary?.issueCount ?? 0;
      const total = blocking + (summary?.checkCount ?? 0);
      return total > 0 ? [{ batch, blocking, total }] : [];
    })
    .sort((a, b) => Number(b.blocking > 0) - Number(a.blocking > 0) || a.batch.code.localeCompare(b.batch.code))
    .map(({ batch, blocking, total }): DashboardAttentionItem => ({
      id: `batch-todos-${batch.id}`,
      stage: "production",
      recordKind: "creditBatch",
      recordIds: [batch.id],
      date: null,
      title: todosLabel(total).replace(/^./, (first) => first.toUpperCase()),
      entityCode: [batch.code, blocking > 0 ? `${blocking} blocking` : null].filter(Boolean).join(" · "),
      href: recordHref("creditBatch", batch.id, { facilityId: batch.facilityId }),
    }));
  const scoped = selectedBatchId == null ? rows : scopeAttentionItems(rows, [selectedBatchId]);
  return failure
    ? [...scoped, {
        id: "batch-todos-failed", stage: "production", recordKind: "creditBatch", recordIds: [], date: null,
        title: BATCH_TODOS_FAILED_TITLE, entityCode: "Credit batches", href: facilityListHref("/credit-batches", failure.facilityId),
      }]
    : scoped;
}
