import type { EntityOption } from "@/components/forms/entity-select/types";
import { creditBatchOptionLabel } from "@/lib/credit-batch-option-label";
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
    name: creditBatchOptionLabel(row),
    subtitle: formatCreditBatchStatus(row.status),
  };
}
