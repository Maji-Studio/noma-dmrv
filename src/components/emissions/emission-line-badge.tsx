/** A line's state as a status badge, labelled from EMISSION_LINE_STATE_LABELS. */
import type { ComponentProps } from "react";
import { StatusBadge, type StatusValue } from "@/components/ui";
import { EMISSION_LINE_STATE_LABELS, type EmissionLineState } from "@/lib/certification/emission-lines";

const STATE_STATUS: Record<EmissionLineState, StatusValue> = {
  filled: "complete",
  confirmedZero: "complete",
  empty: "draft",
  missingEvidence: "pending",
  needsReview: "pending",
  needsSetup: "failed",
};

export function EmissionLineBadge({ state, className, size }: { state: EmissionLineState; className?: string; size?: ComponentProps<typeof StatusBadge>["size"] }) {
  return <StatusBadge status={STATE_STATUS[state]} label={EMISSION_LINE_STATE_LABELS[state]} className={className} size={size} />;
}
