"use client";

import { CheckCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip } from "@/components/ui/tooltip";
import type { EntityCertifyReadiness } from "@/lib/certification/entity-readiness";

interface EntityCertifyReadinessBadgeProps {
  readiness: EntityCertifyReadiness;
}

/**
 * Certification readiness pill — a StatusBadge, so the "Certification" column is
 * literally the same primitive as the adjacent "Status" column (same anatomy,
 * same status ramp), not a lookalike.
 *
 * - ready      → st-ok   ✓  "Ready"
 * - incomplete → st-wait ⚠  "Incomplete (N)" — hover/focus reveals exactly
 *                which gaps remain, so "where is it missing" is always one
 *                interaction away rather than buried in a post-save toast.
 */
export function EntityCertifyReadinessBadge({
  readiness,
}: EntityCertifyReadinessBadgeProps) {
  const ready = readiness.state === "ready";
  const gapCount = readiness.gaps.length;

  const pill = ready ? (
    <StatusBadge
      status="ready"
      icon={<CheckCircleIcon size={14} weight="fill" />}
    />
  ) : (
    <StatusBadge
      status="pending"
      label={`Incomplete (${gapCount})`}
      icon={<WarningIcon size={14} weight="fill" />}
    />
  );

  if (ready) {
    return (
      <span aria-label="Ready for certification" className="inline-flex">
        {pill}
      </span>
    );
  }

  return (
    <Tooltip content={<ReadinessGapList readiness={readiness} />}>
      <button
        type="button"
        // The pill lives inside clickable table rows / detail sheets; this
        // trigger only reveals the gap list, so swallow the click.
        onClick={(e) => e.stopPropagation()}
        aria-label={`Incomplete for certification with ${gapCount} gap${
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
 * The list of unmet certification requirements, shown inside the badge's
 * tooltip. Each gap's `detail` is a full sentence ("Status must be complete
 * to certify", "Operation diesel is required to certify"), so the reader sees
 * precisely what to fix without leaving the page.
 */
function ReadinessGapList({
  readiness,
}: {
  readiness: EntityCertifyReadiness;
}) {
  return (
    <div className="flex flex-col gap-4 text-left">
      <span className="font-medium">Still needed to certify</span>
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
    </div>
  );
}
