/**
 * Shared Activity copy (docs/ux-writing.md). "Activity" is the surface name;
 * "Trail" is reserved for custody evidence (GLOSSARY.md).
 */
import { ACTIVITY_RECORDING_STARTED_AT } from "@/config/activity";
import { pluralize } from "@/lib/copy-utils";
import { formatDate } from "@/lib/format-utils";

export const ACTIVITY_TITLE = "Activity";

export function activityRecordingStartLabel(): string {
  return formatDate(ACTIVITY_RECORDING_STARTED_AT);
}

export const ACTIVITY_EMPTY_TITLE = "No activity recorded yet";

export function activityEmptyDescription(): string {
  return `Activity is recorded from ${activityRecordingStartLabel()}. Changes to this credit batch and its records appear here.`;
}

/** Closes a complete list: nothing older exists to load. */
export function activityHistoryStartNote(): string {
  return `Activity is recorded from ${activityRecordingStartLabel()}. Earlier changes are not listed.`;
}

export const ACTIVITY_FILTERED_EMPTY_TITLE = "No matching activity";
export const ACTIVITY_FILTERED_EMPTY_DESCRIPTION = "Change or clear the filters to see more activity.";
export const ACTIVITY_CLEAR_FILTERS_LABEL = "Clear filters";

export const ACTIVITY_LOAD_ERROR = "Activity could not be loaded. Retry to load it.";
export const ACTIVITY_LOADING = "Loading activity…";
export const ACTIVITY_SHOW_MORE_LABEL = "Show older activity";
export const ACTIVITY_DELETED_RECORD_LABEL = "Deleted record";
/** Leads the field names a creation recorded. */
export const ACTIVITY_CREATED_FIELDS_LABEL = "Recorded";
export const ACTIVITY_OPEN_ALL_LABEL = "Open all activity";

export function activityChangeCount(count: number): string {
  return `${count.toLocaleString()} ${pluralize(count, "change")}`;
}

export function activityLoadedMessage(count: number): string {
  return `${activityChangeCount(count)} loaded.`;
}
