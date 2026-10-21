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

/**
 * The credit batches an unsaved Delivery, Application or Biochar Product
 * would join, from the source the form has chosen (#1350).
 */
export interface RecordCreditBatchPreview {
  /** Distinct batches, by window start then code. */
  batches: RecordCreditBatch[];
  /** The source was drawn pro-rata from a mix bin, so the application is held out (ADR 0030); batches is empty. */
  heldOut: boolean;
  /**
   * True when the draw or share is planned as the save will post it, so the
   * record joins exactly `batches`. False when only the source is known: the
   * batches it holds, of which the mass entered decides which ones.
   */
  exact: boolean;
  /** Production runs behind the planned draw (exact) or the source's stock. */
  sourceRunCount: number;
  /** Of those runs, the ones in no credit batch yet. */
  unbatchedRunCount: number;
}
