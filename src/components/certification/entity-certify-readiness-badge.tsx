"use client";

import { CheckCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip } from "@/components/ui/tooltip";
import type { EntityCertifyReadiness } from "@/lib/certification/entity-readiness";

interface EntityCertifyReadinessBadgeProps {
  readiness: EntityCertifyReadiness;
  /** Override the ready-state pill when the evaluated scope is narrower than certification. */
  readyLabel?: string;
  /** Accessible/tooltip scope for incomplete gaps. Defaults to certification. */
  readinessNoun?: string;
}

/**
 * Certification readiness pill — a StatusBadge, so the "Certification" column is
 * literally the same primitive as the adjacent "Status" column (same anatomy,
 * same status ramp), not a lookalike.
 *
 * - ready      → st-ok   ✓  "Ready"
 * - warning    → st-wait ⚠  "Ready (N warnings)" — submission stays available
 * - incomplete → st-wait ⚠  "Incomplete (N)" — hover/focus reveals exactly
 *                which gaps remain, so "where is it missing" is always one
 *                interaction away rather than buried in a post-save toast.
 */
export function EntityCertifyReadinessBadge({
  readiness,
  readyLabel,
  readinessNoun = "certification",
}: EntityCertifyReadinessBadgeProps) {
  const ready = readiness.state === "ready";
  const gapCount = readiness.gaps.length;
  const warningCount = readiness.warnings.length;
  const hasWarnings = warningCount > 0;

  const pill = ready && !hasWarnings ? (
    <StatusBadge
      status="ready"
      label={readyLabel}
      icon={<CheckCircleIcon size={14} weight="fill" />}
    />
  ) : ready ? (
    <StatusBadge
      status="pending"
      label={`Ready (${warningCount} warning${warningCount === 1 ? "" : "s"})`}
      icon={<WarningIcon size={14} weight="fill" />}
    />
  ) : (
    <StatusBadge
      status="pending"
      label={`Incomplete (${gapCount})`}
      icon={<WarningIcon size={14} weight="fill" />}
    />
  );

  if (ready && !hasWarnings) {
    return (
      <span
        aria-label={readyLabel ?? "Ready for certification"}
        className="inline-flex"
      >
        {pill}
      </span>
    );
  }

  if (ready) {
    return (
      <Tooltip
        content={
          <ReadinessGapList
            readiness={readiness}
            readinessNoun={readinessNoun}
          />
        }
      >
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Ready for ${readinessNoun} with ${warningCount} warning${
            warningCount === 1 ? "" : "s"
          } — submission remains available`}
          className="inline-flex cursor-help rounded-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] focus-visible:ring-offset-1"
        >
          {pill}
        </button>
      </Tooltip>
    );
  }

  const incompleteLabel =
    readinessNoun === "certification"
      ? "Incomplete for certification"
      : `Incomplete ${readinessNoun}`;

  return (
    <Tooltip
      content={
        <ReadinessGapList
          readiness={readiness}
          readinessNoun={readinessNoun}
        />
      }
    >
      <button
        type="button"
        // The pill lives inside clickable table rows / detail sheets; this
        // trigger only reveals the gap list, so swallow the click.
        onClick={(e) => e.stopPropagation()}
        aria-label={`${incompleteLabel} with ${gapCount} gap${
          gapCount === 1 ? "" : "s"
        } — activate to see what's missing`}
        className="inline-flex cursor-help rounded-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] focus-visible:ring-offset-1"
      >
        {pill}
      </button>
    </Tooltip>
  );
}

/**
 * The blocking gaps and advisory warnings shown inside the badge tooltip.
 */
function ReadinessGapList({
  readiness,
  readinessNoun,
}: {
  readiness: EntityCertifyReadiness;
  readinessNoun: string;
}) {
  return (
    <div className="flex flex-col gap-4 text-left">
      {readiness.gaps.length > 0 && (
        <>
          <span className="font-medium">
            {readinessNoun === "certification"
              ? "Still needed to certify"
              : `Still needed for ${readinessNoun}`}
          </span>
          <ul className="flex flex-col gap-2">
            {readiness.gaps.map((gap) => (
              <li key={gap.key} className="flex items-start gap-6">
                <span aria-hidden className="mt-2 leading-none">
                  •
                </span>
                <span>{gap.detail}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {readiness.warnings.length > 0 && (
        <>
          <span className="font-medium">Advisory warnings</span>
          <ul className="flex flex-col gap-2">
            {readiness.warnings.map((warning) => (
              <li key={warning.key} className="flex items-start gap-6">
                <span aria-hidden className="mt-2 leading-none">
                  •
                </span>
                <span>{warning.detail}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
