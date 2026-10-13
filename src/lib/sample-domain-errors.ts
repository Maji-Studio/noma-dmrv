import { SampleRatioCapError } from "@/lib/calculations/sample-ratios";
import { DomainError } from "@/lib/domain-errors";
import { ActionConflictError, SafeError } from "@/lib/errors";
import { RATIO_INPUT_MAX } from "@/schemas/helpers";
import { COMBINED_CARBON_EXCEEDS_TOTAL_MESSAGE, ORGANIC_CARBON_EXCEEDS_TOTAL_MESSAGE } from "@/schemas/samples";

/**
 * Lab Sample guard refusals and how they cross the runner boundary.
 *
 * Writers throw the `SafeError` subtypes below, so a Server Action shows the
 * same operator copy it always has. `withSampleErrors` turns them into typed
 * outcomes with the input they point at, as `withOutputStockErrors` does for
 * stock: 404 on `/creditBatchId` for a missing or archived batch, 422 on the
 * field for everything else.
 */

type Path = (string | number)[];

/** Legacy writer copy, shared so the operator prose stays byte-identical. */
export const SAMPLE_CREDIT_BATCH_NOT_FOUND_MESSAGE = "Credit batch not found";

/** The 1,000-year evidence each Sample needs, keyed by the input that supplies it. */
export const SAMPLE_TIER_EVIDENCE_MESSAGES = {
  randomReflectanceR0Percent: "R₀ reflectance is required for a Sample on a 1000-year credit batch.",
  residualCarbonPercent: "TGA non-reactive carbon is required for a Sample on a 1000-year credit batch.",
  sReflectanceFraction: "R₀ readings at or above 2% are required for a Sample on a 1000-year credit batch.",
} as const;

export const SAMPLE_FUTURE_TIME_MESSAGES = {
  samplingTime: "Sampling time cannot be in the future. Enter a time at or before now.",
} as const;

const SAMPLE_CARBON_RECONCILIATION_MESSAGES = {
  organicCarbonPercent: ORGANIC_CARBON_EXCEEDS_TOTAL_MESSAGE,
  inorganicCarbonPercent: COMBINED_CARBON_EXCEEDS_TOTAL_MESSAGE,
} as const;

export type SampleTierEvidenceField = keyof typeof SAMPLE_TIER_EVIDENCE_MESSAGES;
export type SampleCarbonField = keyof typeof SAMPLE_CARBON_RECONCILIATION_MESSAGES;
export type SampleRefusalField = SampleTierEvidenceField | SampleCarbonField | "samplingTime";

export interface SampleBatchWindow {
  code: string;
  startDate: string;
  endDate: string;
}

/** The refusal for a sampling day before its credit batch's production window. */
export function sampleBeforeBatchWindowMessage(samplingDay: string, batch: SampleBatchWindow): string {
  return `Sample date ${samplingDay} is before credit batch ${batch.code}'s production window, ${batch.startDate} to ${batch.endDate}. Choose a date within or after the production window.`;
}

/** The Sample's credit batch is missing from the organization, or archived (round 7 Q56). */
export class SampleCreditBatchUnavailableError extends SafeError {
  constructor(message: string) {
    super(message);
    this.name = "SampleCreditBatchUnavailableError";
  }
}

/** A Sample guard refused one input. */
export class SampleFieldError extends SafeError {
  readonly field: SampleRefusalField;

  constructor(message: string, field: SampleRefusalField) {
    super(message);
    this.name = "SampleFieldError";
    this.field = field;
  }
}

export function sampleCreditBatchNotFound(): SampleCreditBatchUnavailableError {
  return new SampleCreditBatchUnavailableError(SAMPLE_CREDIT_BATCH_NOT_FOUND_MESSAGE);
}

export function sampleCreditBatchArchived(code: string): SampleCreditBatchUnavailableError {
  return new SampleCreditBatchUnavailableError(`Credit batch ${code} is archived. Choose an active credit batch.`);
}

export function sampleTierEvidenceError(field: SampleTierEvidenceField): SampleFieldError {
  return new SampleFieldError(SAMPLE_TIER_EVIDENCE_MESSAGES[field], field);
}

/** Reconciliation is an excess check: organic, or organic plus inorganic, above total carbon. */
export function sampleCarbonReconciliationError(field: SampleCarbonField): SampleFieldError {
  return new SampleFieldError(SAMPLE_CARBON_RECONCILIATION_MESSAGES[field], field);
}

export function sampleBeforeBatchWindowError(samplingDay: string, batch: SampleBatchWindow): SampleFieldError {
  return new SampleFieldError(sampleBeforeBatchWindowMessage(samplingDay, batch), "samplingTime");
}

function typed(code: "validation_failed" | "not_found", error: SafeError, path: Path, meta?: Record<string, unknown>): DomainError {
  const failure = new DomainError(code, error.message, { issues: [{ path, code, message: error.message, ...(meta ? { meta } : {}) }] });
  // The guard already normalized this operator message through SafeError.
  failure.message = error.message;
  return failure;
}

/**
 * Sample guards as typed outcomes across the runner boundary. A missing or
 * archived batch is `not_found` on `/creditBatchId`; a field refusal or a
 * calculated ratio above the stored maximum is `validation_failed` on its
 * input. A `DomainError` (stale version, future time, certification lock
 * already typed by `withFeedstockErrors(..., "certification_locked")`) passes
 * through; a conflict keeps its record; any other safe refusal is
 * `validation_failed`, on `path` when given.
 */
export async function withSampleErrors<T>(work: () => Promise<T>, path?: Path): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (error instanceof SampleCreditBatchUnavailableError) throw typed("not_found", error, ["creditBatchId"]);
    if (error instanceof SampleFieldError) throw typed("validation_failed", error, [error.field]);
    if (error instanceof SampleRatioCapError) {
      throw typed("validation_failed", error, [error.field], { ratio: error.ratio, max: RATIO_INPUT_MAX });
    }
    if (error instanceof ActionConflictError) {
      throw new DomainError("conflict", error.message, { conflict: error.conflict, blockers: error.blockers });
    }
    if (error instanceof SafeError) {
      const failure = new DomainError("validation_failed", error.message, {
        issues: path ? [{ path, code: "validation_failed", message: error.message }] : undefined,
      });
      failure.message = error.message;
      throw failure;
    }
    throw error;
  }
}
