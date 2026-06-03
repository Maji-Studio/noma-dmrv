/**
 * SubmissionStatusBadge
 * Thin renderer over the canonical status mappers in `@/lib/certification`. A
 * Removal is local-only (no remote status exists in this integration); a GHG
 * Statement folds in the persisted remote overlay (`metadata.remoteStatus`) so
 * operators see "Awaiting verifier" / "Credits issued" rather than a flat
 * "Submitted". "In progress" derives from the lock-flight check. The row →
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
}

export function SubmissionStatusBadge({
  latest,
  isLockedInFlight,
  artifact = "removal",
}: SubmissionStatusBadgeProps) {
  const derived = deriveSubmissionStatus(latest, isLockedInFlight, artifact);
  return <StatusBadge status={derived.value} label={derived.label} />;
}
