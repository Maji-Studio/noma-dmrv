/**
 * SubmissionStatusBadge
 * Pill rendering the latest credit-batch → Removal submission state.
 * "In progress" derives from the lock-flight check, not from the row's
 * status alone.
 */
import type { CertificationSubmissionRow } from "@/data-access/certification";
import { StatusBadge, type StatusValue } from "@/components/ui/status-badge";

interface SubmissionStatusBadgeProps {
  latest: CertificationSubmissionRow | null;
  isLockedInFlight: boolean;
}

export function SubmissionStatusBadge({
  latest,
  isLockedInFlight,
}: SubmissionStatusBadgeProps) {
  if (!latest) {
    return <StatusBadge status="draft" label="Not submitted" />;
  }
  if (isLockedInFlight) {
    return <StatusBadge status="running" label="In progress" />;
  }
  const { status, value, label } = mapStatus(latest.status);
  return <StatusBadge status={value} label={label} title={status} />;
}

function mapStatus(s: CertificationSubmissionRow["status"]): {
  status: string;
  value: StatusValue;
  label: string;
} {
  switch (s) {
    case "draft":
      // Stale-locked or rejected-cleared: caller treats as actionable.
      return { status: s, value: "draft", label: "Draft" };
    case "submitted":
      return { status: s, value: "issued", label: "Submitted" };
    case "accepted":
      return { status: s, value: "verified", label: "Accepted" };
    case "rejected":
      return { status: s, value: "rejected", label: "Rejected" };
    case "superseded":
      return { status: s, value: "draft", label: "Superseded" };
    default:
      return { status: s, value: "draft", label: s };
  }
}
