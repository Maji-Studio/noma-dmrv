import type { StatusStateClass } from "@/lib/status-state";

const DASHBOARD_STATE_SEVERITY: Record<StatusStateClass, number> = {
  neutral: 0,
  success: 1,
  "in-progress": 2,
  warning: 3,
  error: 4,
};

/**
 * Resolves mixed dashboard signals to the state with the greatest operator
 * urgency. The fallback represents an all-clear dashboard.
 */
export function deriveWorstDashboardState(
  states: readonly StatusStateClass[],
  fallback: StatusStateClass = "success",
): StatusStateClass {
  return states.reduce(
    (worst, state) =>
      DASHBOARD_STATE_SEVERITY[state] > DASHBOARD_STATE_SEVERITY[worst]
        ? state
        : worst,
    fallback,
  );
}

/**
 * The Needs attention summary is orange whenever operator follow-through is
 * needed and green when nothing is open. Blocking checks describe urgency,
 * not a failed or rejected state.
 */
export function deriveAttentionSummaryState(total: number): StatusStateClass {
  return total > 0 ? "warning" : "success";
}
