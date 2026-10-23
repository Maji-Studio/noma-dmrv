import { ActionError, isActionError } from "@/lib/action-error";
import type { FacilityDistanceInput } from "@/schemas/facility-distances";

/**
 * Server row issues name the pair's facility or source; the form shows one
 * control per row, so they land on its distance input. Prefix with
 * `locations.0.` for a payload that wraps its one location.
 */
export const FACILITY_DISTANCE_REFUSAL_ALIASES = {
  "facilityDistances.*.facilityId": "facilityDistances.*.distanceKm",
  "facilityDistances.*.distanceSource": "facilityDistances.*.distanceKm",
} as const;

/** Same rows for the quick add, whose payload wraps its one location in `locations.0`. */
export const NESTED_FACILITY_DISTANCE_REFUSAL_ALIASES = {
  "locations.0.facilityDistances.*.facilityId": "facilityDistances.*.distanceKm",
  "locations.0.facilityDistances.*.distanceSource": "facilityDistances.*.distanceKm",
  "locations.0.facilityDistances.*.*": "facilityDistances.*.*",
} as const;

const DISTANCES_SEGMENT = "facilityDistances";

/**
 * The payload sends only changed pairs, so a refusal's row index counts those,
 * while the form's rows are all facilities. Point each row issue at the form
 * row of the same facility; other refusals pass through untouched.
 */
export function withFormDistanceRows(
  error: unknown,
  submitted: readonly FacilityDistanceInput[] = [],
  formRows: readonly FacilityDistanceInput[] = [],
): unknown {
  if (!isActionError(error)) return error;
  const issues = error.issues.map(issue => {
    const at = issue.path.indexOf(DISTANCES_SEGMENT);
    const row = at < 0 ? undefined : issue.path[at + 1];
    if (typeof row !== "number") return issue;
    const index = formRows.findIndex(item => item.facilityId === submitted[row]?.facilityId);
    return index < 0 ? issue : { ...issue, path: issue.path.map((part, i) => i === at + 1 ? index : part) };
  });
  return new ActionError({
    error: error.message, code: error.code, issues, conflict: error.conflict, blockers: error.blockers, preview: error.preview,
  });
}

/** Omitted pairs stay unchanged; null only clears a previously saved distance. */
export function facilityDistanceChanges(
  current: readonly FacilityDistanceInput[] = [],
  saved: readonly FacilityDistanceInput[] = [],
): FacilityDistanceInput[] {
  return current.filter(row => {
    const previous = saved.find(pair => pair.facilityId === row.facilityId);
    if (row.distanceKm === null) return previous?.distanceKm != null;
    return row.distanceKm !== previous?.distanceKm || row.distanceSource !== previous?.distanceSource;
  });
}
