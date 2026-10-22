import { MOISTURE_READING_WARNING_POINTS } from '@/config/output-stock';
import { formatFacilityTime } from '@/lib/date-utils';
import { formatFacilityDateTime } from '@/lib/format-utils';
import { formatMoisturePercent } from '@/lib/mass-moisture';
import type { OutputMoistureEstimate } from '@/types/output-stock';
import type { MoistureBasis } from './moisture-estimate';

/** The bin card's date: month and day on the facility clock. */
const CAPTION_DATE_FORMAT = 'MMM d';

/** Points are shown to one decimal, like the moisture figures they compare. */
const POINT_DIGITS = 1;

/** The estimate a moisture field shows next to an empty input. */
export interface MoistureFieldEstimate {
  moisturePercent: number | null;
  /** Where the estimate comes from, for the field's ⓘ; null when there is nothing to date. */
  basisText: string | null;
}

/** What a draw is called in a sentence, by the kind of movement that re-estimated the bin. */
const DRAW_NAMES: Record<string, string> = {
  loss: 'the lost mass',
  delivery: 'the delivery',
  production_draw: 'the product draw',
};
const FALLBACK_DRAW_NAME = 'a draw';

function drawName(kind: string): string {
  return DRAW_NAMES[kind] ?? FALLBACK_DRAW_NAME;
}

/** Where an output bin's estimate comes from, on the facility clock. */
export function moistureBasisText(basis: MoistureBasis | null, timeZone: string): string | null {
  if (!basis) return null;
  const at = formatFacilityDateTime(basis.at, timeZone);
  if (basis.source === 'draw') return `From ${drawName(basis.kind)} on ${at}, which was wetter than the bin's estimate.`;
  return basis.source === 'reading'
    // The app no longer records counts, but an old one still dates the estimate; it reads as its history entry does.
    ? `From the stock count on ${at}.`
    : `From the moisture recorded when the batch was added on ${at}.`;
}

/**
 * The bin card's line when a draw measured wetter than the bin set its
 * moisture: "Moisture estimated from the lost mass of Oct 20". Null for every
 * other basis, since only this one surprises the operator.
 */
export function moistureDrawCaption(basis: MoistureBasis | null | undefined, timeZone: string): string | null {
  if (basis?.source !== 'draw') return null;
  return `Moisture estimated from ${drawName(basis.kind)} of ${formatFacilityTime(new Date(basis.at), timeZone, CAPTION_DATE_FORMAT)}`;
}

/** An output bin's estimate as a field estimate, dated on the facility clock. */
export function outputMoistureFieldEstimate(estimate: OutputMoistureEstimate | null | undefined, timeZone: string): MoistureFieldEstimate | null {
  return estimate ? { moisturePercent: estimate.moisturePercent, basisText: moistureBasisText(estimate.basis, timeZone) } : null;
}

/**
 * What a moisture field says around a reading: the estimate as its `cue` under
 * the input, its basis for the ⓘ, and an advisory when the reading is further
 * from the estimate than `MOISTURE_READING_WARNING_POINTS`. The estimate is
 * never a value: the operator measures and types every reading.
 */
export function moistureReadingGuidance(estimate: MoistureFieldEstimate | null, reading: number | null | undefined) {
  const estimated = estimate?.moisturePercent ?? null;
  // Compared at the precision shown, so "5.0 points" never warns against a limit of 5.
  const gap = estimated !== null && typeof reading === 'number' && Number.isFinite(reading) ? Number(Math.abs(reading - estimated).toFixed(POINT_DIGITS)) : null;
  return {
    cue: estimated === null ? undefined : `Estimated moisture: ${formatMoisturePercent(estimated)}`,
    basisText: estimated === null ? undefined : estimate?.basisText ?? undefined,
    // Says which way the reading is off, in points shown like the figures ("12", not "12.0").
    warning: gap !== null && gap > MOISTURE_READING_WARNING_POINTS
      ? `${formatMoisturePercent(reading as number)} is ${String(gap)} points ${(reading as number) > estimated! ? 'above' : 'below'} the ${formatMoisturePercent(estimated)} estimate. Check the reading before you save.`
      : undefined,
  };
}
