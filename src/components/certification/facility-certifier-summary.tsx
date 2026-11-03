/**
 * FacilityCertifierSummary — the read-only registry-link block shown inside the
 * facility side-sheet (Stage 6 / ADR 0007). The facility sheet used to host the
 * full management UI (`FacilityCertifierSection`: link / edit / unlink project,
 * template selection, link hints). That config now lives in its primary home,
 * Settings, Facilities, so the facility sheet shows only a read-only
 * summary + a "Manage in Settings" link. The durability tier is changed there too.
 *
 * Reads the DB-only summary (`useFacilityCertifierSummary`) — never the heavier
 * management payload (available projects, link hints), which a non-managing
 * viewer must not pull. The project shows as its persisted id. The removal
 * template reads by its display name, looked up in the project's template list
 * (as the credit batch does); its registry id stays behind the (i).
 */
"use client";

import Link from "next/link";
import { useFacilityCertifierSummary, useIsometricProjectTemplates } from "@/hooks/use-certification";
import { DetailField } from "@/components/ui/detail-panel";
import { RawIdentifiers } from "./removal-template-mapping-view";
import { LOAD_FAILED, MISSING_VALUE, NOT_FOUND_ON_ISOMETRIC } from "@/lib/copy-utils";
import { facilityCertificationSettingsHref } from "@/lib/certification/links";
import { EnvBanner } from "./env-banner";
import { Field, Section } from "./panel-layout";

// The link carries the viewed facility in `?facility=`, which also makes it the
// working facility: this summary renders in the facility side sheet, which can
// show a facility other than the sidebar-selected one, and Settings, Facilities
// configures the working facility.
const settingsHref = facilityCertificationSettingsHref;

export function FacilityCertifierSummary({
  facilityId,
}: {
  facilityId: string;
}) {
  const query = useFacilityCertifierSummary(facilityId);

  return (
    <Section>
      <div className="flex flex-col gap-12">
        <div className="flex items-center justify-between gap-12">
          <h3 className="title-chapter-title">Isometric Certify</h3>
          <Link
            href={settingsHref(facilityId)}
            className="body-caption text-[var(--color-text-tertiary)] underline underline-offset-2 hover:text-[var(--color-text-secondary)]"
          >
            Manage in Settings, Facilities ↗
          </Link>
        </div>

        <SummaryBody query={query} facilityId={facilityId} />
      </div>
    </Section>
  );
}

function SummaryBody({
  query,
  facilityId,
}: {
  query: ReturnType<typeof useFacilityCertifierSummary>;
  facilityId: string;
}) {
  if (query.isLoading) {
    return (
      <p className="body-small text-[var(--color-text-tertiary)]">
        Loading registry link…
      </p>
    );
  }
  if (query.error || !query.data) {
    return (
      <p className="body-small text-[var(--color-signal-red)]" role="alert">
        The registry link could not be loaded. Refresh the page and try again.
      </p>
    );
  }

  const { mapping, isProduction } = query.data;

  if (!mapping) {
    return (
      <div className="flex flex-col gap-8">
        <EnvBanner isProduction={isProduction} variant="inline" />
        <p className="body-small text-[var(--color-text-secondary)]">
          This facility isn&apos;t linked to an Isometric project. Link it in{" "}
          <Link
            href={settingsHref(facilityId)}
            className="underline underline-offset-2 hover:text-[var(--color-text-primary)]"
          >
            Settings, Facilities
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-12">
      <EnvBanner isProduction={isProduction} variant="inline" />

      <Field label="Project">
        <span className="body-small font-mono text-[var(--color-text-primary)]">
          {mapping.externalProjectId}
        </span>
      </Field>

      {mapping.removalTemplateId ? (
        <RemovalTemplateField projectId={mapping.externalProjectId} templateId={mapping.removalTemplateId} />
      ) : (
        <Field label="Removal template">
          <span className="body-small text-[var(--color-text-tertiary)]">
            {MISSING_VALUE.notSet}
          </span>
        </Field>
      )}
    </div>
  );
}

/**
 * The template's display name as a detail field: a skeleton while the project's
 * templates load, a settled reason when the name cannot be read. The registry
 * id stays in the technical details.
 */
function RemovalTemplateField({ projectId, templateId }: { projectId: string; templateId: string }) {
  const templates = useIsometricProjectTemplates(projectId);
  const name = templates.data?.find((template) => template.id === templateId)?.display_name;
  const reason = name ? null : templates.isError ? LOAD_FAILED : templates.isSuccess ? NOT_FOUND_ON_ISOMETRIC : null;
  return (
    <div className="flex flex-col gap-8">
      <DetailField
        label="Removal template"
        value={name ?? reason}
        emptySituation="notSet"
        valuePresent={reason ? false : undefined}
        pending={!name && !reason}
      />
      <RawIdentifiers summary="Technical details" entries={[["Template", templateId]]} />
    </div>
  );
}
