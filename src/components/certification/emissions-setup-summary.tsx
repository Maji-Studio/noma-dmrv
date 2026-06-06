"use client";

// Overview-grain summary of Project-scope emissions drift (ADR 0005 Posture B).
// The full per-component breakdown lives in Settings → Emissions
// (`ProjectEmissionsDriftPanel`); this is the operator-facing one-liner on the
// certification Overview: "N registry emission components aren't recorded
// locally yet — reconcile in Settings." It deliberately drops the registry
// vocabulary (orphans / blueprint / audit-trail row) the detail panel uses.
//
// Renders nothing when there's nothing to say (loading, not configured, no
// project link, or no emissions to reconcile at all) so the Overview stays
// calm — a clean facility shows a single quiet "reconciled" line, not a box of
// warnings.

import Link from "next/link";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useProjectEmissionDrift } from "@/hooks/use-project-emissions";

function settingsEmissionsHref(facilityId: string): string {
  return `/certification/settings?tab=emissions&facility=${encodeURIComponent(
    facilityId,
  )}`;
}

export function EmissionsSetupSummary() {
  const { facilityId } = useFacilityContext();
  const { data, isLoading } = useProjectEmissionDrift(
    facilityId ?? "",
    !!facilityId,
  );

  // Nothing actionable for an operator on the Overview in these states — the
  // detail panel in Settings handles configuration/connection gaps. Stay quiet
  // rather than nag from the landing page.
  if (
    !facilityId ||
    isLoading ||
    !data ||
    !data.isometricConfigured ||
    !data.externalProjectId
  ) {
    return null;
  }

  const recordedCount = data.rows.length;
  const unmatchedRowCount = data.rows.filter(
    (r) => r.status.kind !== "match",
  ).length;
  // A registry component with no matching local row — the common "you haven't
  // transcribed the LCA values yet" case. Plain-language, no "orphan".
  const unrecordedCount = data.orphans.length;
  const issueCount = unmatchedRowCount + unrecordedCount;

  // Nothing configured on either side yet — there's genuinely nothing to
  // reconcile, so don't render an empty reassurance box.
  if (issueCount === 0 && recordedCount === 0) {
    return null;
  }

  const href = settingsEmissionsHref(facilityId);

  if (issueCount === 0) {
    return (
      <section className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-16">
        <p className="title-chapter-title text-[var(--color-text-tertiary)] mb-8">
          Emissions setup
        </p>
        <p className="body-small text-[var(--color-text-secondary)]">
          <span aria-hidden className="mr-4 text-[var(--color-signal-green)]">
            ✓
          </span>
          <span className="sr-only">OK: </span>
          All period emissions reconcile with the registry.
        </p>
      </section>
    );
  }

  const message =
    unrecordedCount > 0 && unmatchedRowCount === 0
      ? `${unrecordedCount} registry emission component${
          unrecordedCount === 1 ? "" : "s"
        } not yet recorded locally.`
      : unmatchedRowCount > 0 && unrecordedCount === 0
        ? `${unmatchedRowCount} recorded emission${
            unmatchedRowCount === 1 ? "" : "s"
          } not yet matched in the registry.`
        : `${issueCount} emission item${
            issueCount === 1 ? "" : "s"
          } need reconciling with the registry.`;

  return (
    <section className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-16">
      <p className="title-chapter-title text-[var(--color-text-tertiary)] mb-8">
        Emissions setup
      </p>
      <div className="flex items-start justify-between gap-16 border-l-2 border-[var(--color-signal-orange)] pl-12 py-4">
        <div className="flex flex-col gap-2 min-w-0">
          <p className="body-small text-[var(--color-text-primary)]">
            <span className="sr-only">Needs attention: </span>
            {message}
          </p>
          <p className="body-caption text-[var(--color-text-tertiary)]">
            These come from your LCA — record each value so submissions
            reconcile.
          </p>
        </div>
        <Link
          href={href}
          className="body-small shrink-0 whitespace-nowrap underline underline-offset-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          Set up →
        </Link>
      </div>
    </section>
  );
}
