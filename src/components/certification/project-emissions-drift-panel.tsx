"use client";

// Read-only drift panel for `PROJECT`-scope Project Components (ADR 0005
// Posture B). Compares each `/admin/emission-estimates` "Period emissions"
// row to the Components Isometric reports, and surfaces a directional
// warning for either side missing a counterpart. UI matches the existing
// drift conventions in `certify-panel.tsx` (`BlockerNotice` orange
// left-border for warnings, `TransportCoverageNotice` border-top status
// strip for the matched-OK case).

import Link from "next/link";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useProjectEmissionDrift } from "@/hooks/use-project-emissions";
import { Button } from "@/components/ui/button";

function statusToReason(status: { kind: string; reason?: string }): string {
  return "reason" in status && status.reason ? status.reason : "";
}

// Renders one finding. `icon` carries semantic severity and is mirrored to
// screen-reader-only text — color/glyph alone (the orange left border + the
// `!` mark) is not assistive-tech accessible.
function DriftRow({ icon, message, fixHint, fixHref }: {
  icon: "match" | "warn";
  message: string;
  fixHint?: string;
  fixHref?: string;
}) {
  if (icon === "match") {
    return (
      <li className="list-none border-t border-[var(--color-border-secondary)] pt-8 first:border-t-0 first:pt-0">
        <p className="body-small text-[var(--color-text-primary)]">
          <span className="sr-only">OK: </span>
          <span aria-hidden className="mr-4">✓</span>
          {message}
        </p>
      </li>
    );
  }
  return (
    <li className="list-none border-l-2 border-[var(--color-signal-orange)] pl-12 py-4">
      <p className="body-small text-[var(--color-text-primary)]">
        <span className="sr-only">Warning: </span>
        <span aria-hidden className="mr-4">!</span>
        {message}
      </p>
      {fixHint &&
        (fixHref ? (
          <Link
            href={fixHref}
            className="body-caption text-[var(--color-text-tertiary)] underline underline-offset-2 hover:text-[var(--color-text-secondary)]"
          >
            {fixHint}
          </Link>
        ) : (
          <p className="body-caption text-[var(--color-text-tertiary)]">
            {fixHint}
          </p>
        ))}
    </li>
  );
}

export function ProjectEmissionsDriftPanel() {
  const { facilityId } = useFacilityContext();
  const { data, isLoading, isError, error, refetch, isFetching } =
    useProjectEmissionDrift(facilityId ?? "", !!facilityId);

  if (!facilityId) {
    return (
      <section className="border border-[var(--color-border-secondary)] p-16">
        <header className="mb-12">
          <p className="title-chapter-title">Registry reconciliation</p>
        </header>
        <p className="body-small text-[var(--color-text-tertiary)]">
          Select a facility to see Project-scope emissions drift.
        </p>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className="border border-[var(--color-border-secondary)] p-16">
        <header className="mb-12">
          <p className="title-chapter-title">Registry reconciliation</p>
        </header>
        <p
          className="body-small text-[var(--color-text-tertiary)]"
          role="status"
          aria-live="polite"
        >
          Loading drift…
        </p>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section
        className="border border-[var(--color-border-secondary)] p-16"
        role="alert"
      >
        <header className="mb-12 flex items-baseline justify-between gap-12">
          <p className="title-chapter-title">Registry reconciliation</p>
          <Button
            size="small"
            variant="weak"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? "Retrying…" : "Retry"}
          </Button>
        </header>
        <ul className="space-y-8">
          <DriftRow
            icon="warn"
            message={
              error instanceof Error
                ? error.message
                : "Failed to load Project-scope drift."
            }
          />
        </ul>
      </section>
    );
  }

  if (!data.isometricConfigured) {
    return (
      <section className="border border-[var(--color-border-secondary)] p-16">
        <header className="mb-12">
          <p className="title-chapter-title">Registry reconciliation</p>
        </header>
        <DriftRow
          icon="warn"
          message="Isometric credentials are not configured — drift cannot be reconciled."
          fixHint="Set ISOMETRIC_CLIENT_SECRET + ISOMETRIC_ACCESS_TOKEN to enable."
        />
      </section>
    );
  }

  if (!data.externalProjectId) {
    return (
      <section className="border border-[var(--color-border-secondary)] p-16">
        <header className="mb-12">
          <p className="title-chapter-title">Registry reconciliation</p>
        </header>
        <DriftRow
          icon="warn"
          message="Facility is not linked to an Isometric project."
          fixHint="Link a project in facility settings →"
          fixHref="/facilities"
        />
      </section>
    );
  }

  const totalRows = data.rows.length;
  const matchedRows = data.rows.filter((r) => r.status.kind === "match").length;
  const orphanCount = data.orphans.length;
  const allClean = totalRows === matchedRows && orphanCount === 0;

  return (
    <section className="border border-[var(--color-border-secondary)] p-16">
      <header className="mb-12 flex items-baseline justify-between gap-12">
        <p className="title-chapter-title">Registry reconciliation</p>
        <p className="body-caption text-[var(--color-text-tertiary)]">
          {matchedRows}/{totalRows} reconciled · {orphanCount} not recorded
          locally
        </p>
      </header>

      <ul className="space-y-8">
        {totalRows === 0 && orphanCount === 0 && (
          <DriftRow
            icon="warn"
            message="No period emissions recorded yet."
            fixHint="Add rows in the journal below."
          />
        )}

        {allClean && totalRows > 0 && (
          <DriftRow
            icon="match"
            message={`All ${totalRows} period-emission row${
              totalRows === 1 ? "" : "s"
            } match a Project Component in Isometric.`}
          />
        )}

        {data.rows.map(({ row, status }) => {
          if (status.kind === "match") {
            return (
              <DriftRow
                key={row.id}
                icon="match"
                message={`${row.category} — ${row.magnitude}${row.unit} (window ${row.lcaWindowStartOn} → ${row.lcaWindowEndOn})`}
              />
            );
          }
          if (status.kind === "ambiguous") {
            return (
              <DriftRow
                key={row.id}
                icon="warn"
                message={`Ambiguous match for ${row.category} (${row.magnitude}${row.unit}) — ${statusToReason(status) || `${status.candidates.length} Components in Isometric match. Reconcile manually.`}`}
                fixHint="Give each Component a distinct display_name in Isometric."
              />
            );
          }
          return (
            <DriftRow
              key={row.id}
              icon="warn"
              message={`Missing in Isometric — ${row.category} (${row.magnitude}${row.unit}, window ${row.lcaWindowStartOn} → ${row.lcaWindowEndOn}). ${statusToReason(status)}`}
              fixHint="Author the Project Component in the Isometric UI →"
            />
          );
        })}

        {data.orphans.map((o) => (
          <DriftRow
            key={o.component.id}
            icon="warn"
            message={`Registry component "${o.component.display_name}" isn't recorded in the journal yet.`}
            fixHint="Add a matching row in the journal below."
          />
        ))}
      </ul>
    </section>
  );
}
