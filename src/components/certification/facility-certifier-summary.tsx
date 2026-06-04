/**
 * FacilityCertifierSummary — the read-only registry-link block shown inside the
 * facility side-sheet (Stage 6 / ADR 0007). The facility sheet used to host the
 * full management UI (`FacilityCertifierSection`: link / edit / unlink project,
 * template selection, link hints). That config now lives in its primary home,
 * Certification → Settings, so the facility sheet shows only a read-only
 * summary + a "Manage in Certification → Settings" link.
 *
 * Reads the DB-only summary (`useFacilityCertifierSummary`) — never the heavier
 * management payload (available projects, templates, link hints), which a
 * non-managing viewer must not pull. The trade-off is that this shows persisted
 * identifiers (project id, default template id, protocol) rather than the
 * human-friendly names, which are only resolvable from the management list.
 */
"use client";

import Link from "next/link";
import { useFacilityCertifierSummary } from "@/hooks/use-certification";
import { EnvBanner } from "./env-banner";
import { Field, Section } from "./panel-layout";

const SETTINGS_HREF = "/certification/settings";

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
            href={SETTINGS_HREF}
            className="body-caption text-[var(--color-text-tertiary)] underline underline-offset-2 hover:text-[var(--color-text-secondary)]"
          >
            Manage in Certification → Settings ↗
          </Link>
        </div>

        <SummaryBody query={query} />
      </div>
    </Section>
  );
}

function SummaryBody({
  query,
}: {
  query: ReturnType<typeof useFacilityCertifierSummary>;
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
      <p className="body-small text-[var(--clr-red)]" role="alert">
        Unable to load the registry link.
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
            href={SETTINGS_HREF}
            className="underline underline-offset-2 hover:text-[var(--color-text-primary)]"
          >
            Certification → Settings
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

      <Field label="Protocol">
        <span className="body-small text-[var(--color-text-primary)]">
          {mapping.protocolSlug}
          {mapping.protocolVersion ? ` · ${mapping.protocolVersion}` : ""}
        </span>
      </Field>

      <Field label="Default removal template">
        {mapping.defaultRemovalTemplateId ? (
          <span className="body-small font-mono text-[var(--color-text-primary)]">
            {mapping.defaultRemovalTemplateId}
          </span>
        ) : (
          <span className="body-small text-[var(--color-text-tertiary)]">
            None selected
          </span>
        )}
      </Field>
    </div>
  );
}
