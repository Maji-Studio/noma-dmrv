/**
 * Shared Activity copy (docs/ux-writing.md). "Activity" is the surface name;
 * "Trail" is reserved for custody evidence (GLOSSARY.md).
 */
import { ACTIVITY_RECORDING_STARTED_AT } from "@/config/activity";
import { pluralize } from "@/lib/copy-utils";
import { UNKNOWN_FACILITY_TIMEZONE } from "@/lib/date-utils";
import { formatFacilityDay } from "@/lib/format-utils";

export const ACTIVITY_TITLE = "Activities";

export function activityRecordingStartLabel(timeZone = UNKNOWN_FACILITY_TIMEZONE): string {
  return formatFacilityDay(ACTIVITY_RECORDING_STARTED_AT, timeZone);
}

export const ACTIVITY_EMPTY_TITLE = "No activity recorded yet";

export function activityEmptyDescription(timeZone = UNKNOWN_FACILITY_TIMEZONE): string {
  return `Activity is recorded from ${activityRecordingStartLabel(timeZone)}. Changes to this credit batch and its records appear here.`;
}

/** Closes a complete list: nothing older exists to load. */
export function activityHistoryStartNote(timeZone = UNKNOWN_FACILITY_TIMEZONE): string {
  return `Activity is recorded from ${activityRecordingStartLabel(timeZone)}. Earlier changes are not listed.`;
}

export const ACTIVITY_FILTERED_EMPTY_TITLE = "No matching activity";
export const ACTIVITY_FILTERED_EMPTY_DESCRIPTION = "Change or clear the filters to see more activity.";
export const ACTIVITY_CLEAR_FILTERS_LABEL = "Clear filters";

export const ACTIVITY_LOAD_ERROR = "Activity could not be loaded. Retry to load it.";
export const ACTIVITY_LOADING = "Loading activity…";
export const ACTIVITY_SHOW_MORE_LABEL = "Show older activity";
export const ACTIVITY_DELETED_RECORD_LABEL = "Deleted record";
export const ACTIVITY_OPEN_ALL_LABEL = "Open all activity";

export function activityChangeCount(count: number): string {
  return `${count.toLocaleString()} ${pluralize(count, "change")}`;
}

export function activityLoadedMessage(count: number): string {
  return `${activityChangeCount(count)} loaded.`;
}
