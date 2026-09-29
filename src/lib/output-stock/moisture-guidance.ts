import { MOISTURE_READING_WARNING_POINTS } from '@/config/output-stock';
import { formatFacilityDateTime } from '@/lib/format-utils';
import { formatMoisturePercent } from '@/lib/mass-moisture';
import type { OutputMoistureEstimate } from '@/types/output-stock';
import type { MoistureBasis } from './moisture-estimate';

/** Points are shown to one decimal, like the moisture figures they compare. */
const POINT_DIGITS = 1;

/** The estimate a moisture field shows next to an empty input. */
export interface MoistureFieldEstimate {
  moisturePercent: number | null;
  /** Where the estimate comes from, for the field's ⓘ; null when there is nothing to date. */
  basisText: string | null;
}

/** Where an output bin's estimate comes from, on the facility clock. */
export function moistureBasisText(basis: MoistureBasis | null, timeZone: string): string | null {
  if (!basis) return null;
  const at = formatFacilityDateTime(basis.at, timeZone);
  return basis.source === 'reading'
    ? `From the reading on ${at}.`
    : `From the moisture recorded when the batch was added on ${at}.`;
}

/** An output bin's estimate as a field estimate, dated on the facility clock. */
export function outputMoistureFieldEstimate(estimate: OutputMoistureEstimate | null | undefined, timeZone: string): MoistureFieldEstimate | null {
  return estimate ? { moisturePercent: estimate.moisturePercent, basisText: moistureBasisText(estimate.basis, timeZone) } : null;
}

/**
 * What a moisture field says around a reading: the estimate as one line under
 * the input, its basis for the ⓘ, and an advisory when the reading is further
 * from the estimate than `MOISTURE_READING_WARNING_POINTS`. The estimate is
 * never a value: the operator measures and types every reading.
 */
export function moistureReadingGuidance(estimate: MoistureFieldEstimate | null, reading: number | null | undefined) {
  const estimated = estimate?.moisturePercent ?? null;
  const gap = estimated !== null && typeof reading === 'number' && Number.isFinite(reading) ? Math.abs(reading - estimated) : null;
  return {
    helperText: estimated === null ? undefined : `Estimated moisture: ${formatMoisturePercent(estimated)}`,
    basisText: estimated === null ? undefined : estimate?.basisText ?? undefined,
    warning: gap !== null && gap > MOISTURE_READING_WARNING_POINTS
      ? `This reading is ${gap.toFixed(POINT_DIGITS)} points from the estimated ${formatMoisturePercent(estimated)}. Check the reading before you save.`
      : undefined,
  };
}
