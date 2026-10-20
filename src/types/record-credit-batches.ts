/** Saved provenance, ordered by batch start date then code. Dates are YYYY-MM-DD. */
export interface RecordCreditBatch {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
}

export interface RecordCreditBatches {
  batches: RecordCreditBatch[];
  /** A mix-bin application is held out of credit batches (ADR 0030); `batches` is empty by design. */
  heldOut: boolean;
}
