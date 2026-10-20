import type { Row } from "@tanstack/react-table";
import {
  NOT_SUBMITTED_LABEL,
  REGISTRY_SUBMITTED_LABEL,
  type SubmittedOnState,
} from "@/lib/certification/submitted-on";
import { formatDate } from "@/lib/format-utils";

/** One line: the date, or why there is none. */
export function submittedOnText(state: SubmittedOnState): string {
  switch (state.kind) {
    case "submitted":
      return formatDate(state.at);
    case "registryDiscovered":
      return REGISTRY_SUBMITTED_LABEL;
    case "never":
      return NOT_SUBMITTED_LABEL;
  }
}

/** Column value: the date text, or undefined for an undated row so it sorts last. */
export function submittedOnSortValue(state: SubmittedOnState): string | undefined {
  return state.kind === "submitted" ? submittedOnText(state) : undefined;
}

function timestamp(state: SubmittedOnState): number {
  return state.kind === "submitted" ? new Date(state.at).getTime() : 0;
}

/**
 * Chronological sort for the "Submitted on" column. Pair it with
 * `sortUndefined: "last"` and `submittedOnSortValue`, so undated rows stay after
 * every dated row in both directions (the sort fn only ever sees dated rows).
 */
export function submittedOnSortingFn<T extends { submittedOn: SubmittedOnState }>(
  a: Row<T>,
  b: Row<T>,
): number {
  return timestamp(a.original.submittedOn) - timestamp(b.original.submittedOn);
}

export function SubmittedOnCell({ state }: { state: SubmittedOnState }) {
  const dated = state.kind === "submitted";
  return (
    <span
      {...(dated ? {} : { "data-empty": true })}
      className={
        dated
          ? "body-small text-[var(--color-text-primary)] whitespace-nowrap"
          : "body-small text-[var(--color-text-tertiary)] whitespace-nowrap"
      }
    >
      {submittedOnText(state)}
    </span>
  );
}
