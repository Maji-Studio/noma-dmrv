/**
 * Production-run timing plumbing for `ProductionRunForm`.
 *
 * A run's start/end are a wall clock at a physical plant, so every conversion
 * between the stored UTC instant and the form's date + time inputs is anchored
 * to the FACILITY's zone, never the browser's. QA F-2: a CEST (UTC+2) browser
 * entering 08:00–16:00 for a UTC+3 plant stored 06:00Z–14:00Z instead of
 * 05:00Z–13:00Z, and the telemetry importer — which clips CSV rows to the
 * stored window — then discarded the readings in the shifted hour with no
 * error at all.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import {
  combineDateAndTime,
  formatFacilityDate,
  formatFacilityTime,
  formatTimezoneLabel,
  NonexistentLocalTimeError,
  resolveFacilityTimezone,
} from "@/lib/date-utils";
import { makeProductionRunFormSchema } from "@/schemas/production-runs";

/** date-fns pattern matching what `<input type="time">` accepts and emits. */
export const TIME_INPUT_FORMAT = "HH:mm";

export const buildProductionRunResolver = (timeZone: string) =>
  zodResolver(makeProductionRunFormSchema(timeZone));

export type ProductionRunResolver = ReturnType<typeof buildProductionRunResolver>;

/**
 * Form defaults for the start/end date + time pairs (issue #259), read back in
 * `timeZone`. The end pair is blank for an unfinished run; an overnight run
 * gets an end date one day on. A new run defaults to the facility's now, not
 * the browser's.
 */
export function productionRunTimingDefaults(
  run: { startTime?: Date | string | null; endTime?: Date | string | null } | undefined,
  timeZone: string,
) {
  const start = run?.startTime ? new Date(run.startTime) : new Date();
  const end = run?.endTime ? new Date(run.endTime) : null;
  return {
    startDate: formatFacilityDate(start, timeZone),
    startTime: formatFacilityTime(start, timeZone, TIME_INPUT_FORMAT),
    endDate: end ? formatFacilityDate(end, timeZone) : "",
    endTime: end ? formatFacilityTime(end, timeZone, TIME_INPUT_FORMAT) : "",
  };
}

/**
 * The instants a submit writes, or the field a DST gap makes unwritable.
 *
 * `endTime` keeps the three-way meaning the mutation relies on: a `Date` to
 * write, `null` to clear a reopened run's end, `undefined` to leave the stored
 * end untouched.
 */
export type ProductionRunWindow =
  | { ok: true; startTime: Date; endTime: Date | null | undefined }
  | { ok: false; field: "startTime" | "endTime"; message: string };

/**
 * Build a run's start/end instants from the form's date + time pairs in
 * `timeZone`.
 *
 * The gap rejection is returned rather than thrown so the form can pin it to
 * the offending field. In practice the schema's `superRefine` — which shares
 * `combineDateAndTime` and therefore its DST policy — has already blocked
 * submit, so this is the second line of the same defence.
 */
export function buildProductionRunWindow(input: {
  startDateStr: string;
  startTimeStr: string;
  endDateStr: string;
  endTimeStr: string | undefined;
  includeEndTime: boolean;
  clearEndTime: boolean;
  timeZone: string;
}): ProductionRunWindow {
  let startTime: Date;
  try {
    startTime = combineDateAndTime(input.startDateStr, input.startTimeStr, input.timeZone);
  } catch (error) {
    if (error instanceof NonexistentLocalTimeError) {
      return { ok: false, field: "startTime", message: error.message };
    }
    throw error;
  }

  if (input.clearEndTime) return { ok: true, startTime, endTime: null };
  if (!input.endTimeStr || !input.includeEndTime) {
    return { ok: true, startTime, endTime: undefined };
  }

  try {
    return {
      ok: true,
      startTime,
      endTime: combineDateAndTime(input.endDateStr, input.endTimeStr, input.timeZone),
    };
  } catch (error) {
    if (error instanceof NonexistentLocalTimeError) {
      return { ok: false, field: "endTime", message: error.message };
    }
    throw error;
  }
}

/**
 * Always-visible cue naming the zone the entered times are interpreted in.
 *
 * `ProductionRunWithRelations` does not carry the facility's zone, so editing a
 * run whose facility is missing from the context list falls back to
 * `DEFAULT_FACILITY_TIMEZONE`. That fallback is stated in the UI rather
 * than applied silently — a silently-wrong default is what caused QA F-2.
 */
export function productionRunTimezoneHelperText(
  facilities: readonly { id: string; timezone: string }[],
  facilityId: string | null | undefined,
): string {
  const resolved = facilityId
    ? facilities.some((facility) => facility.id === facilityId)
    : false;
  const label = formatTimezoneLabel(resolveFacilityTimezone(facilities, facilityId));
  return resolved ? `Facility time — ${label}` : `Facility time unknown — using ${label}`;
}
