/**
 * SubmissionSummary — the read surface of the confirm-&-submit step. One
 * vertical read that answers three questions in order: can I send this, what am
 * I sending, where does it go. Every fact appears exactly once, and the checks
 * list only renders when one of them needs attention — when they all pass the
 * verdict line carries the count.
 *
 * This is a read surface: it gates nothing. `submit-step.tsx` still owns the
 * submit gate via `deriveRemovalReadiness` + `isRemovalCompilationReady`.
 */
"use client";

import {
  CheckCircleIcon,
  SpinnerGapIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { isometricRegistry } from "@/lib/isometric/links";
import { DetailField } from "@/components/ui/detail-panel";
import { EnvBanner } from "../env-banner";
import { LinkLabel } from "./link-label";
import { CompilationWarnings, RemovalAdvisoryList } from "./compilation-notices";
import { BlockedComponentsNotice } from "./blocked-components-notice";
import type { ComponentTable } from "./component-table-model";
import { formatTonnes } from "@/lib/format-utils";
import {
  buildSubmissionFacts,
  countLabel,
  type SubmissionFactsInput,
  type SubmitState,
} from "./submission-facts";
import { SubmissionChecks } from "./submission-checks";
import { Notice } from "@/components/ui/notice";

const STATE_ICON_SIZE = 20;

type SubmissionSummaryProps = SubmissionFactsInput & {
  facilityId: string;
  facilityName: string;
  /** The component table's rows, to name each blocked component in the Notice. */
  table: ComponentTable;
};

function StateIcon({ state }: { state: SubmitState }) {
  if (state === "loading") {
    return (
      <SpinnerGapIcon
        size={STATE_ICON_SIZE}
        weight="bold"
        aria-hidden
        className="shrink-0 animate-spin text-[var(--st-run)]"
      />
    );
  }
  if (state === "blocked") {
    return (
      <WarningIcon
        size={STATE_ICON_SIZE}
        weight="fill"
        aria-hidden
        className="shrink-0 text-[var(--st-bad)]"
      />
    );
  }
  return (
    <CheckCircleIcon
      size={STATE_ICON_SIZE}
      weight="fill"
      aria-hidden
      className="shrink-0 text-[var(--st-ok)]"
    />
  );
}

function RegistryFactLink({
  href,
  label,
  ariaLabel,
}: {
  href: string;
  label: string;
  ariaLabel: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      className="text-[var(--color-text-primary)] underline-offset-4 hover:text-[var(--color-interaction)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
    >
      <LinkLabel>{label}</LinkLabel>
    </a>
  );
}

const ESTIMATE_NOTE =
  "Estimated before project emissions and registry verification. Isometric calculates the final net value.";
const FILES_NOTE = "noma uploads these files to Isometric when you submit.";
const TOTAL_UNIT = "t CO₂e";

export function SubmissionSummary({
  facilityId,
  facilityName,
  table,
  ...factsInput
}: SubmissionSummaryProps) {
  const facts = buildSubmissionFacts(factsInput);
  const { checks } = factsInput;
  const memberBatchIds = facts.batches.map((batch) => batch.id);
  const estimate = factsInput.compilation?.estimatedStoredCo2eTonnes ?? null;
  const environment = facts.isProduction ? "production" : "sandbox";
  const externalProjectId = factsInput.ctx.mapping?.externalProjectId ?? null;
  const externalFacilityId = factsInput.ctx.mapping?.externalFacilityId ?? null;
  const destinationLabel = facts.projectLabel
    ? `${facts.projectLabel} (${facts.environmentLabel})`
    : "Not linked";

  return (
    <div className="flex flex-col gap-24">
      <div
        className="flex items-start gap-12"
        role={facts.state === "blocked" ? "alert" : "status"}
      >
        <span className="mt-2">
          <StateIcon state={facts.state} />
        </span>
        <div className="flex flex-col gap-2">
          <span className="body-medium font-medium text-[var(--color-text-primary)]">
            {facts.headline}
          </span>
          {facts.detail && (
            <span className="body-small text-[var(--color-text-secondary)]">
              {facts.detail}
            </span>
          )}
        </div>
      </div>

      <BlockedComponentsNotice
        blockers={facts.blockers}
        // The verdict is still being prepared: the Notice waits for it, the rows already say Blocked.
        blockedRows={facts.state === "loading" ? [] : table.rows.filter((row) => row.state === "blocked")}
        facilityId={facilityId}
        memberBatchIds={memberBatchIds}
      />

      {facts.checksAttention > 0 && (
        <SubmissionChecks checks={checks} facilityId={facilityId} creditBatches={facts.batches} />
      )}

      {/* The totals: what Isometric will be sent, at a glance. */}
      <div className="grid grid-cols-2 gap-16 md:grid-cols-4">
        <DetailField
          label="Estimated CO₂e stored"
          hint={ESTIMATE_NOTE}
          value={
            estimate == null ? null : `≈ ${formatTonnes(estimate, { unit: TOTAL_UNIT })}`
          }
          emptySituation="notYetComputed"
        />
        <DetailField label="Biochar dry mass" value={facts.dryTons} />
        <DetailField
          label="Reporting window"
          value={facts.reportingWindowLabel}
          emptySituation="notYetComputed"
        />
        <DetailField
          label="Files to upload"
          hint={FILES_NOTE}
          value={facts.pendingDocuments > 0 ? countLabel(facts.pendingDocuments, "file") : null}
          emptySituation="none"
        />
      </div>

      {/* Read data stays visible in both modes (R1): the quieter facts sit under the totals. */}
      <div className="grid grid-cols-2 gap-16 md:grid-cols-4">
        <DetailField
          label="Destination"
          value={
            externalProjectId ? (
              <RegistryFactLink
                href={isometricRegistry.certifyProject({
                  environment,
                  externalProjectId,
                })}
                label={destinationLabel}
                ariaLabel={`Open destination ${destinationLabel} in Isometric in a new tab`}
              />
            ) : (
              destinationLabel
            )
          }
          valuePresent={Boolean(facts.projectLabel)}
        />
        <DetailField
          label="Facility"
          value={
            externalProjectId && externalFacilityId ? (
              <RegistryFactLink
                href={isometricRegistry.facility({
                  environment,
                  externalProjectId,
                  externalFacilityId,
                })}
                label={facilityName}
                ariaLabel={`Open facility ${facilityName} in Isometric in a new tab`}
              />
            ) : (
              facilityName
            )
          }
        />
        <DetailField label="Durability" value={facts.durabilityLabel} />
        <DetailField label="Sampling" value={facts.samplingLabel} />
      </div>

      {factsInput.readiness.transportVehicleAdvisories.map((advisory) => (
        <Notice key={advisory} tone="warning">{advisory}</Notice>
      ))}

      {(facts.advisories.length > 0 || facts.warnings.length > 0) && (
        <Notice tone="warning" title="Submission notes">
          <div className="flex flex-col gap-8">
            <RemovalAdvisoryList advisories={facts.advisories} facilityId={facilityId} memberBatchIds={memberBatchIds} />
            <CompilationWarnings warnings={facts.warnings} />
          </div>
        </Notice>
      )}

      {facts.isProduction && <EnvBanner isProduction variant="inline" />}
    </div>
  );
}
