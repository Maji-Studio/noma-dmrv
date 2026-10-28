import type { Sample, TransportLeg } from "@/db/schema";
import { isUsableNumber, isUsableRatio } from "@/lib/calculations/biochar-eligibility";
import { formatFacilityDate, formatUtcDate } from "@/lib/date-utils";
import type { TransportLegsByCategory } from "@/lib/isometric/utils/aggregation";

const numberOrNull = (value: number | null | undefined) => isUsableNumber(value) ? value : null;
const ratioOrNull = (value: number | null | undefined) => isUsableRatio(value) ? value : null;

/** Retain created-at ordering and delivery identity ordering across all readers. */
export function orderedLegs(legs: TransportLeg[]) {
  return [...legs].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) || a.id.localeCompare(b.id));
}

export function orderedTransportLedgerLegs(legs: TransportLegsByCategory): TransportLegsByCategory {
  return {
    feedstock: orderedLegs(legs.feedstock),
    biochar: [...legs.biochar].sort((a, b) => a.id.localeCompare(b.id)),
    sample: orderedLegs(legs.sample),
  };
}

/** Raw evidence operands only: no formulas, labels or display rounding. */
export function transportLedgerInput(leg: TransportLeg) {
  return {
    distanceKm: leg.distanceKm,
    loadMassKg: leg.loadMassKg != null && leg.loadMassKg > 0 ? leg.loadMassKg : 0,
    transportMethodType: leg.transportMethodType.length
      ? leg.transportMethodType[0].toUpperCase() + leg.transportMethodType.slice(1) : "",
  };
}

/** All chemistry operands contribute; only usable H/C replicates render rows. */
export function selectTwoHundredYearLedgerSamples(samples: Sample[], facilityTimezone?: string | null) {
  const selected = samples.map(sample => {
    const rendered = isUsableRatio(sample.hToCOrgRatio);
    const total = numberOrNull(sample.totalCarbonPercent);
    const inorganic = numberOrNull(sample.inorganicCarbonPercent);
    const organic = rendered || (inorganic === null && total !== null)
      ? numberOrNull(sample.organicCarbonPercent) : null;
    return { sample, input: {
      hToCOrgRatio: ratioOrNull(sample.hToCOrgRatio),
      oToCOrgRatio: ratioOrNull(sample.oToCOrgRatio),
      totalCarbonPercent: total, inorganicCarbonPercent: inorganic,
      organicCarbonPercent: organic,
      ...(rendered ? { samplingDay: samplingDayOf(sample.samplingTime, facilityTimezone) } : {}),
    } };
  });
  const replicates = selected.filter(row => row.input.hToCOrgRatio !== null);
  return { samples: replicates.length ? selected : [], replicates };
}

/** Complete measured carbon/S replicates, retaining original row references. */
export function selectThousandYearLedgerSamples(samples: Sample[], facilityTimezone?: string | null) {
  return [...samples].sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .flatMap((sample, index) => {
      if (!isUsableNumber(sample.totalCarbonPercent) || !isUsableNumber(sample.inorganicCarbonPercent) || !isUsableNumber(sample.sReflectanceFraction)) return [];
      return [{ sample, index, input: {
        samplingDay: samplingDay(sample.samplingTime, facilityTimezone),
        totalCarbonPercent: sample.totalCarbonPercent,
        inorganicCarbonPercent: sample.inorganicCarbonPercent,
        sReflectanceFraction: sample.sReflectanceFraction,
      } }];
    });
}

// ISO calendar day (YYYY-MM-DD) of a sampling timestamp, for the §8.3.1
// distribution evidence, resolved in the facility's local timezone so the
// ledger classifies a sampling instant on the SAME calendar day as the write
// guard and submission gate. Falls back to UTC only when the timezone is absent
// (light fixtures). Reads an existing Date/string — no clock access. Typed
// `unknown` because the column maps to `Date` but raw rows / test fixtures can
// carry a string.
export function samplingDayOf(
  samplingTime: unknown,
  facilityTimezone: string | null | undefined,
): string | null {
  if (samplingTime instanceof Date) {
    return formatDayInZone(samplingTime, facilityTimezone);
  }
  if (typeof samplingTime === "string" && samplingTime.length >= 10) {
    // A timestamp string (carries a time/offset component) must resolve through
    // the SAME facility/UTC branch as a Date — otherwise an offset-bearing value
    // like `2026-01-15T03:30:00.000Z` slices to the UTC day and diverges from the
    // Date-backed local day. A bare date-only string is already a calendar day.
    if (samplingTime.includes("T")) {
      const parsed = new Date(samplingTime);
      if (!Number.isNaN(parsed.getTime())) {
        return formatDayInZone(parsed, facilityTimezone);
      }
    }
    return samplingTime.slice(0, 10);
  }
  return null;
}

/** Format a Date as its YYYY-MM-DD calendar day in the facility zone (UTC fallback). */
function formatDayInZone(
  date: Date,
  facilityTimezone: string | null | undefined,
): string | null {
  const day = facilityTimezone
    ? formatFacilityDate(date, facilityTimezone)
    : formatUtcDate(date);
  return day || null;
}

export function samplingDay(
  value: unknown,
  facilityTimezone: string | null | undefined,
): string | null {
  const parsed =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return null;
  return facilityTimezone
    ? formatFacilityDate(parsed, facilityTimezone)
    : formatUtcDate(parsed);
}

