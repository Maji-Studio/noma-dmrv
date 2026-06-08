import { CheckCircle, Warning } from "@phosphor-icons/react";
import type { EntityCertifyReadiness } from "@/lib/certification/entity-readiness";

interface EntityCertifyReadinessBadgeProps {
  readiness: EntityCertifyReadiness;
}

/**
 * Certification readiness pill. Shares the visual language of the list
 * StatusBadge (icon + background tint, sentence case, no border) so the
 * "Certifier" column reads as a sibling of the adjacent "Status" column.
 *
 * - ready      → green  ✓  "Ready"
 * - incomplete → amber  ⚠  "Incomplete (N)"
 */
export function EntityCertifyReadinessBadge({
  readiness,
}: EntityCertifyReadinessBadgeProps) {
  const ready = readiness.state === "ready";
  const gapCount = readiness.gaps.length;

  const label = ready ? "Ready" : `Incomplete (${gapCount})`;
  const colorClass = ready
    ? "text-[var(--color-signal-green)] bg-[var(--color-signal-green)]/10"
    : "text-[var(--color-signal-orange)] bg-[var(--color-signal-orange)]/10";

  return (
    <span
      aria-label={
        ready
          ? "Ready for certification"
          : `Incomplete for certification with ${gapCount} gap${
              gapCount === 1 ? "" : "s"
            }`
      }
      className={`inline-flex items-center gap-4 whitespace-nowrap px-8 py-2 text-[var(--text-xs)] font-medium ${colorClass}`}
    >
      {ready ? (
        <CheckCircle size={14} weight="fill" />
      ) : (
        <Warning size={14} weight="fill" />
      )}
      {label}
    </span>
  );
}
