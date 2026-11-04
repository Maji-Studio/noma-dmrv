import type { EntityOption } from "@/components/forms/entity-select/types";
import { creditBatchName } from "@/lib/credit-batch-label";
import { formatDateRange } from "@/lib/format-utils";
import {
  formatCreditBatchStatus,
  type CreditBatchStatus,
} from "@/schemas/credit-batches";

interface CreditBatchOptionRow {
  id: string;
  code: string;
  name: string | null;
  status: CreditBatchStatus;
  startDate: string;
  endDate: string;
}

export function toCreditBatchEntityOption(
  row: CreditBatchOptionRow,
): EntityOption {
  const dates = formatDateRange(row.startDate, row.endDate);
  const name = creditBatchName(row);
  return {
    id: row.id,
    code: row.code,
    name: name ? `${name} · ${dates}` : dates,
    subtitle: formatCreditBatchStatus(row.status),
  };
}
