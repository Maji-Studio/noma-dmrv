import {
  NOT_SUBMITTED_LABEL,
  REGISTRY_SUBMITTED_LABEL,
  type SubmittedOnState,
} from "@/lib/certification/submitted-on";
import { formatDate } from "@/lib/format-utils";
import { undatedLastSortingFn } from "./undated-last-sort";

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

function timestamp(state: SubmittedOnState): number | null {
  return state.kind === "submitted" ? new Date(state.at).getTime() : null;
}

/** Chronological sort for the "Submitted on" column; undated rows stay last in both directions. */
export function submittedOnSortingFn<T extends { submittedOn: SubmittedOnState }>(
  descending: boolean,
) {
  return undatedLastSortingFn<T>((item) => timestamp(item.submittedOn), descending);
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
