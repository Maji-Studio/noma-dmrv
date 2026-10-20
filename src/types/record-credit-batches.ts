/** Saved provenance, ordered by batch start date then code. Dates are YYYY-MM-DD. */
export interface RecordCreditBatch {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
}

export interface RecordCreditBatches {
  batches: RecordCreditBatch[];
  /**
   * True for a mix-bin application with no Removal-owned slices; batches is empty.
   * Products retain source provenance and return false (ADR 0030).
   */
  heldOut: boolean;
}
