/**
 * View model for the 200-Year Durability Evidence Ledger PDF.
 *
 * A pure, render-agnostic description of noma's working behind a 200-year
 * removal's durability measurement-sample submission: per credit batch, the raw
 * ≥3 lab replicate values reconciled into the submitted mean ± std-dev, the
 * protocol eligibility verdict (molar H/C_org < 0.5 AND O/C_org < 0.2), the
 * attribution-scaled product mass, and the facility soil-temperature reference.
 *
 * Built by `durability-build-model.ts` from the removal's credit-batch-grained
 * durability data (the SAME `buildPerBatchDurabilityData` figures that feed the
 * measurement-sample POST, so the ledger reconciles to what's submitted), and
 * consumed by `durability-pdf.ts` (react-pdf). Keeping the model free of any
 * react-pdf type means the reconciliation math is unit-testable without a
 * renderer. The COA stays the lab's own certificate; this is noma's working.
 *
 * Figures here are in noma's native units (dimensionless H/C, carbon %, kg, °C)
 * — NOT the registry wire units (the ×100 H/C / %→fraction transforms are a
 * separate, sandbox-gated submission concern). The ledger evidences the
 * aggregation, not the wire encoding.
 */

/**
 * `documents.metadata.kind` tag for an auto-generated durability evidence ledger.
 * Lets the submit pipeline locate (and supersede) a removal's prior ledgers
 * independent of which member credit batch they were attached to.
 */
export const DURABILITY_EVIDENCE_LEDGER_KIND = "durability_evidence_ledger";

export interface DurabilityEvidenceLedgerDocMetadata {
  kind: typeof DURABILITY_EVIDENCE_LEDGER_KIND;
  removalId: string;
  /** Semantic fingerprint of the ledger (batches/figures, excluding render time). */
  contentHash: string;
}

/** A replicate mean and its sample (n−1) std-dev; std null when < 2 replicates. */
export interface LedgerStat {
  mean: number;
  /** Sample standard deviation; null when fewer than 2 usable replicates. */
  stdDev: number | null;
}

/** One raw lab replicate row backing a batch's submitted figures. */
export interface LedgerReplicate {
  /** Display index, e.g. "R1" / "R2" — the §8.3.1 ≥3-count is visible. */
  ref: string;
  sampleCode: string;
  /** ISO calendar day (YYYY-MM-DD) the sample was drawn; null when unknown. */
  samplingDay: string | null;
  labName: string | null;
  hToCorg: number | null;
  oToCorg: number | null;
  totalCarbonPercent: number | null;
  organicCarbonPercent: number | null;
  /** Measured inorganic carbon %, or Eq.2-derived max(0, Total − Organic). */
  inorganicCarbonPercent: number | null;
  /** True when inorganic carbon was derived (Total − Organic), not measured. */
  inorganicDerived: boolean;
}

/** The protocol permanence verdict for a batch (judged on the pooled paired mean). */
export interface LedgerEligibility {
  hToCorgMean: number | null;
  oToCorgMean: number | null;
  /** mean < 0.5; null when the H/C_org mean is indeterminate. */
  hToCWithinThreshold: boolean | null;
  /** mean < 0.2; null when the O/C_org mean is indeterminate. */
  oToCWithinThreshold: boolean | null;
  /** true / false once both means resolve; null when indeterminate (fails closed). */
  eligible: boolean | null;
}

export interface LedgerBatch {
  creditBatchId: string;
  creditBatchCode: string;
  /** Replicate rows carrying a usable H/C_org (the §8.3.1 ≥3-count set). */
  replicates: LedgerReplicate[];
  /** Usable H/C_org replicate count (also the §8.3.1 ≥3 gate input). */
  replicateCount: number;
  /** Distinct (run, day) provenance count — evidences §8.3.1 distribution. */
  distinctDayCount: number;
  /** Submitted H/C_org mean ± std-dev (dimensionless molar). */
  hToCorg: LedgerStat;
  /** Submitted total carbon % mean ± std-dev. */
  totalCarbonPercent: LedgerStat | null;
  /** Submitted inorganic carbon % mean ± std-dev (measured or Eq.2-derived). */
  inorganicCarbonPercent: LedgerStat | null;
  /** O/C_org mean ± std-dev — eligibility gate only, not a submitted value. */
  oToCorg: LedgerStat | null;
  /** Submitted attribution-scaled biochar dry mass (kg). */
  productMassKg: number;
  eligibility: LedgerEligibility;
}

/** The facility-level soil-temperature reference (ADR 0013 / soil module §5). */
export interface LedgerSoilReference {
  declaredSoilTemperatureC: number;
  /** Submitted value: declared, 7 °C-floored, one decimal. */
  effectiveSoilTemperatureC: number;
  /** True when the declared value was below 7 °C and raised to the floor. */
  temperatureFloored: boolean;
  /** Dataset / region citation recorded for the PDD audit trail, or null. */
  source: string | null;
  /** Short method string (carries the floor + dataset justification). */
  method: string;
}

export interface DurabilityLedgerModel {
  memberBatchCodes: string | null;
  facilityName: string | null;
  externalProjectId: string | null;
  /** ISO date string, injected by the caller (no clock reads in the builder). */
  generatedAtIso: string;
  /** One entry per SAMPLED credit batch (unsampled batches carry no chemistry). */
  batches: LedgerBatch[];
  soil: LedgerSoilReference;
  /** Count of batches passing the eligibility gate (of `batches.length`). */
  eligibleBatchCount: number;
  totalReplicates: number;
}
