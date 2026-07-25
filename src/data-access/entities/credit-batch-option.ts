import type { EntityOption } from "@/components/forms/entity-select/types";
import { formatDateRange } from "@/lib/format-utils";
import {
  formatCreditBatchStatus,
  type CreditBatchStatus,
} from "@/schemas/credit-batches";

interface CreditBatchOptionRow {
  id: string;
  code: string;
  status: CreditBatchStatus;
  startDate: string;
  endDate: string;
}

export function toCreditBatchEntityOption(
  row: CreditBatchOptionRow,
): EntityOption {
  return {
    id: row.id,
    code: row.code,
    name: row.code,
    subtitle: `${formatDateRange(row.startDate, row.endDate)} · ${formatCreditBatchStatus(row.status)}`,
  };
}
