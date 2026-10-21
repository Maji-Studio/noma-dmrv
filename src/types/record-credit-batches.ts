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
 * What a credit batch preview could plan (#1350):
 * - `planned`: the draw or share as the save will post it; `batches` is exact.
 * - `source`: nothing to plan yet; `batches` are the ones the source holds.
 * - `refused`: the save would refuse the entered draw or amount; no batches.
 * - `untraceable`: the delivery's saved stock allocation is missing or does not balance; no batches.
 */
export type RecordCreditBatchPreviewBasis = "planned" | "source" | "refused" | "untraceable";

/**
 * The credit batches an unsaved Delivery, Application or Biochar Product
 * would join, from the source the form has chosen (#1350).
 */
export interface RecordCreditBatchPreview {
  /** Distinct batches, by window start then code. */
  batches: RecordCreditBatch[];
  /** The source was drawn pro-rata from a mix bin, so the application is held out (ADR 0030); batches is empty. */
  heldOut: boolean;
  basis: RecordCreditBatchPreviewBasis;
  /** Production runs behind the planned draw or the source's stock. */
  sourceRunCount: number;
  /** Of those runs, the ones in no credit batch yet. */
  unbatchedRunCount: number;
}
