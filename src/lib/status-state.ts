/**
 * Canonical visual classes for semantic entity statuses.
 *
 * Status-bearing UI must resolve through this seam so a status has the same
 * meaning everywhere it appears. Callers with an unknown status get the
 * neutral treatment instead of choosing a palette token locally.
 */

export const STATUS_STATE_CLASSES = [
  "neutral",
  "in-progress",
  "success",
  "warning",
  "error",
] as const;

export type StatusStateClass = (typeof STATUS_STATE_CLASSES)[number];

export const DEFAULT_STATUS_STATE: StatusStateClass = "neutral";

export const ENTITY_STATUS_STATES = {
  // Neutral / inactive
  draft: "neutral",
  superseded: "neutral",
  cancelled: "neutral",
  missing_data: "neutral",
  no_deliveries: "neutral",

  // Active / in progress
  running: "in-progress",
  sold: "in-progress",
  ordered: "in-progress",
  partial: "in-progress",
  submitted: "in-progress",

  // Successful / complete
  complete: "success",
  delivered: "success",
  applied: "success",
  verified: "success",
  issued: "success",
  ready: "success",
  processed: "success",
  fulfilled: "success",
  uploaded: "success",
  succeeded: "success",
  accepted: "success",
  eligible: "success",

  // Waiting / attention
  pending: "warning",
  upcoming: "warning",
  testing: "warning",
  scheduled: "warning",
  conditional: "warning",

  // Failed / invalid
  void: "error",
  failed: "error",
  rejected: "error",
  ineligible: "error",
} as const satisfies Record<string, StatusStateClass>;

export type SemanticEntityStatus = keyof typeof ENTITY_STATUS_STATES;

export const STATUS_STATE_BADGE_CLASSES: Record<StatusStateClass, string> = {
  neutral:
    "bg-[var(--st-off-bg)] text-[var(--color-text-secondary)] border-[var(--st-off-border)]",
  "in-progress":
    "bg-[var(--st-run-bg)] text-[var(--st-run)] border-[var(--st-run-border)]",
  success:
    "bg-[var(--st-ok-bg)] text-[var(--st-ok)] border-[var(--st-ok-border)]",
  warning:
    "bg-[var(--st-wait-bg)] text-[var(--st-wait)] border-[var(--st-wait-border)]",
  error:
    "bg-[var(--st-bad-bg)] text-[var(--st-bad)] border-[var(--st-bad-border)]",
};

export const STATUS_STATE_COLOR_TOKENS: Record<StatusStateClass, string> = {
  neutral: "var(--st-off)",
  "in-progress": "var(--st-run)",
  success: "var(--st-ok)",
  warning: "var(--st-wait)",
  error: "var(--st-bad)",
};

export function getStatusState(status: string): StatusStateClass {
  if (Object.hasOwn(ENTITY_STATUS_STATES, status)) {
    return ENTITY_STATUS_STATES[status as SemanticEntityStatus];
  }

  return DEFAULT_STATUS_STATE;
}

export function getStatusStateColor(status: string): string {
  return STATUS_STATE_COLOR_TOKENS[getStatusState(status)];
}
