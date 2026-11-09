export interface RemovalLedgerInput {
  id: string;
  component: string;
  input: string;
  magnitude: number | null;
  unit: string;
  /** Why a required input has no magnitude. Null whenever `magnitude` is set. */
  missingReason: string | null;
}

export interface RemovalLedgerClaim {
  creditBatchId: string;
  creditBatchCode: string;
  claimingRemovalId: string | null;
  claimingRemovalCode: string | null;
  contribution: "production-and-delivery" | "delivery-only";
}

export interface RemovalLedgerPreview {
  inputs: RemovalLedgerInput[];
  inputsUnavailable: boolean;
  claims: RemovalLedgerClaim[];
  creditBatches: Array<{ id: string; code: string }>;
  productionRuns: Array<{ id: string; code: string | null }>;
  applications: Array<{
    id: string;
    code: string;
    deliveryCode: string;
    creditBatchIds: string[];
  }>;
}

