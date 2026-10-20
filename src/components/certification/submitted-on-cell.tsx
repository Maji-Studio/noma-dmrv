import {
  NOT_SUBMITTED_LABEL,
  type SubmittedOnState,
} from "@/lib/certification/submitted-on";
import { formatDate } from "@/lib/format-utils";
import { MISSING_VALUE } from "@/lib/copy-utils";

/** One line: the date, or why there is none. A statement the registry already
 * held when we first synced it has no operator submit date to show. */
export function submittedOnText(state: SubmittedOnState): string {
  switch (state.kind) {
    case "submitted":
      return formatDate(state.at);
    case "registryDiscovered":
      return MISSING_VALUE.notRecorded;
    case "never":
      return NOT_SUBMITTED_LABEL;
  }
}

export function SubmittedOnCell({ state }: { state: SubmittedOnState }) {
  return (
    <span
      className={
        state.kind === "submitted"
          ? "body-small text-[var(--color-text-primary)] whitespace-nowrap"
          : "body-small text-[var(--color-text-tertiary)] whitespace-nowrap"
      }
    >
      {submittedOnText(state)}
    </span>
  );
}
