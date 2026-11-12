/**
 * The To do rows for credit batches: one per active batch whose page shows
 * open to-dos (Blocking + Check, the Overview badge). Waiting items never
 * count. Batches with blocking items come first, then by code.
 */
import type { CreditBatchHealthSummary } from "@/fn/certification";
import { creditBatchNameWithCode } from "@/lib/credit-batch-label";
import { todosLabel } from "@/lib/credit-batches/batch-page";
import { recordHref } from "@/lib/record-links";
import type { DashRowData } from "./shared";

interface TodoBatch {
  id: string;
  code: string;
  name?: string | null;
  facilityId: string;
}

type TodoCounts = Pick<CreditBatchHealthSummary, "issueCount" | "checkCount">;

export function batchTodoRows(
  batches: readonly TodoBatch[],
  summaries: Readonly<Record<string, TodoCounts | undefined>>,
  selectedBatchId: string | null,
): DashRowData[] {
  return batches
    .filter((batch) => selectedBatchId == null || batch.id === selectedBatchId)
    .flatMap((batch) => {
      const summary = summaries[batch.id];
      const blocking = summary?.issueCount ?? 0;
      const total = blocking + (summary?.checkCount ?? 0);
      return total > 0 ? [{ batch, blocking, total }] : [];
    })
    .sort((a, b) => Number(b.blocking > 0) - Number(a.blocking > 0) || a.batch.code.localeCompare(b.batch.code))
    .map(({ batch, blocking, total }) => ({
      id: `batch-todos-${batch.id}`,
      title: `${creditBatchNameWithCode(batch)}: ${todosLabel(total)}`,
      meta: blocking > 0 ? `${blocking} blocking` : "",
      href: recordHref("creditBatch", batch.id, { facilityId: batch.facilityId }),
    }));
}
