/**
 * The words of the Emissions entry footer's credit batch line (#1059 section 2).
 * An entry belongs to the credit batch whose Emissions page opened the form, so
 * the batch is always known and the line needs no lookup. Pure, so it is tested
 * without a server.
 */
import {
  CREDIT_BATCH_LINE_BASE,
  type CreditBatchLineCopy,
} from "@/components/credit-batches/credit-batch-line-copy";
import type { EmissionBatch } from "./emission-line-display";

export const EMISSION_ENTRY_CREDIT_BATCH_INFO_LABEL = "Which credit batch this entry belongs to";
const INFO =
  "A manual entry belongs to the credit batch it is recorded on. Its date never moves it to another batch.";

export function describeEmissionEntryCreditBatchLine(batch: EmissionBatch): CreditBatchLineCopy {
  return {
    ...CREDIT_BATCH_LINE_BASE,
    lead: "Credit batch: ",
    batches: [{ id: batch.creditBatchId, code: batch.code, startDate: batch.startDate, endDate: batch.endDate }],
    info: INFO,
    infoLabel: EMISSION_ENTRY_CREDIT_BATCH_INFO_LABEL,
  };
}
