/**
 * What the Production Run form footer says about credit batch membership
 * (#1164). The server resolves it with the same predicate the save path uses
 * (#1099: facility-local end day, facility, single feedstock type).
 */

/** A credit batch the preview names. Dates are `YYYY-MM-DD`, window inclusive. */
export interface CreditBatchPreviewBatch {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
}

/** The facts the match used, for the info explanation. */
export interface ProductionRunCreditBatchPreviewBasis {
  /** Facility-local `YYYY-MM-DD` day the batches were matched on. */
  day: string;
  /**
   * `end` for the run's end day (the membership rule). `start` only for a
   * running run without an end time: a provisional stand-in, never final.
   */
  dayBasis: "end" | "start";
  facilityName: string;
  /** IANA zone the day was read in. */
  timeZone: string;
  feedstockTypeName: string;
}

/** Why a member run's edited values no longer fit its credit batch. */
export type ProductionRunCreditBatchMemberConflict =
  | "outside-window"
  | "facility"
  | "feedstock"
  /** Moving a member run back to Running; the server refuses it. */
  | "reopen";

/** The first input the preview still needs, in form order. */
export type ProductionRunCreditBatchPreviewMissing = "facility" | "start" | "end" | "feedstock";

export type ProductionRunCreditBatchPreview =
  /** Failed and cancelled runs never join a credit batch. */
  | { state: "not-applicable"; status: "failed" | "cancelled" }
  | { state: "incomplete"; missing: ProductionRunCreditBatchPreviewMissing }
  /** The source bins hold more than one feedstock type. */
  | { state: "mixed-feedstock"; feedstockTypeCount: number }
  /**
   * The saved run already belongs to `batch`. `conflict` names an edit the
   * save path refuses; `basis` is null while the edited inputs are incomplete.
   */
  | {
      state: "member";
      batch: CreditBatchPreviewBatch;
      basis: ProductionRunCreditBatchPreviewBasis | null;
      conflict: ProductionRunCreditBatchMemberConflict | null;
    }
  /**
   * Exactly one open credit batch covers the day. `expected` when the run is
   * not complete: it joins only once completed.
   */
  | { state: "match"; batch: CreditBatchPreviewBatch; basis: ProductionRunCreditBatchPreviewBasis; expected: boolean }
  /** One batch covers the day, but a submitted Removal locks its membership. */
  | { state: "locked"; batch: CreditBatchPreviewBatch; basis: ProductionRunCreditBatchPreviewBasis; expected: boolean }
  /** More than one batch covers the day; the save path attaches to none. */
  | { state: "ambiguous"; batches: CreditBatchPreviewBatch[]; basis: ProductionRunCreditBatchPreviewBasis; expected: boolean }
  | { state: "no-match"; basis: ProductionRunCreditBatchPreviewBasis; expected: boolean };
