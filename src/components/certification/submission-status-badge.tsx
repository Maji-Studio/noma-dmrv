/**
 * SubmissionStatusBadge
 * Thin renderer over the canonical status mappers in `@/lib/certification`. A
 * Removal is local-only (no remote status exists in this integration); a GHG
 * Statement folds in the persisted remote overlay (`metadata.remoteStatus`) so
 * operators see the linear ladder ("In registry" → "In verification" →
 * "Verified" → "Issued") rather than a flat, colliding "Submitted" (#250).
 * "In progress" derives from the lock-flight check. The row →
 * status derivation lives in `deriveSubmissionStatus` so list/queue surfaces
 * filter on the exact same verdict this badge renders.
 */
import type { CertificationSubmissionRow } from "@/data-access/certification";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  deriveSubmissionStatus,
  type CertificationArtifact,
} from "@/lib/certification/from-submission";

interface SubmissionStatusBadgeProps {
  latest: CertificationSubmissionRow | null;
  isLockedInFlight: boolean;
  /**
   * Which lifecycle to render. Removals are local-only; statements add the
   * verifier overlay. Defaults to "removal" for backward compatibility.
   */
  artifact?: CertificationArtifact;
  reportingWindow?: { startedOn?: string | null; completedOn?: string | null };
}

export function SubmissionStatusBadge({
  latest,
  isLockedInFlight,
  artifact = "removal",
  reportingWindow,
}: SubmissionStatusBadgeProps) {
  const derived = deriveSubmissionStatus(
    latest,
    isLockedInFlight,
    artifact,
    reportingWindow,
  );
  return <StatusBadge status={derived.value} label={derived.label} />;
}
