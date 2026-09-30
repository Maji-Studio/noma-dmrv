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

import Link from "next/link";
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  SpinnerGapIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { MemberCreditBatch } from "@/fn/certification/certify-context";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { isometricRegistry } from "@/lib/isometric/links";
import { DerivedHeadline } from "@/components/forms/derived-headline";
import { DetailField } from "@/components/ui/detail-panel";
import { InfoHint } from "@/components/ui/tooltip";
import { EnvBanner } from "../env-banner";
import { CompilationWarnings } from "./compilation-notices";
import {
  batchDryTons,
  buildSubmissionFacts,
  countLabel,
  type SubmissionFactsInput,
  type SubmitState,
} from "./submission-facts";
import { SubmissionChecks } from "./submission-checks";
import { Notice } from "@/components/ui/notice";

const STATE_ICON_SIZE = 20;
const BATCH_LINK_ICON_SIZE = 12;

type SubmissionSummaryProps = SubmissionFactsInput & {
  facilityId: string;
  facilityName: string;
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

function BatchLink({
  batch,
  facilityId,
}: {
  batch: MemberCreditBatch;
  facilityId: string;
}) {
  return (
    <Link
      href={creditBatchDeepLinkHref(batch.id, facilityId)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open credit batch ${batch.code} in a new tab`}
      className="inline-flex items-center gap-4 font-mono text-[var(--color-text-primary)] underline-offset-4 hover:text-[var(--color-interaction)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
    >
      {batch.code}
      <ArrowSquareOutIcon size={BATCH_LINK_ICON_SIZE} aria-hidden />
    </Link>
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
      className="inline-flex items-center gap-4 text-[var(--color-text-primary)] underline-offset-4 hover:text-[var(--color-interaction)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
    >
      {label}
      <ArrowSquareOutIcon size={BATCH_LINK_ICON_SIZE} aria-hidden />
    </a>
  );
}

const CALCULATION_NOTE =
  "Isometric calculates stored and net CO₂e after submission.";

export function SubmissionSummary({
  facilityId,
  facilityName,
  ...factsInput
}: SubmissionSummaryProps) {
  const facts = buildSubmissionFacts(factsInput);
  const { checks } = factsInput;
  const environment = facts.isProduction ? "production" : "sandbox";
  const externalProjectId = factsInput.ctx.mapping?.externalProjectId ?? null;
  const externalFacilityId = factsInput.ctx.mapping?.externalFacilityId ?? null;
  const destinationLabel = facts.projectLabel
    ? `${facts.projectLabel} (${facts.environmentLabel})`
    : "Not linked";

  const batchesValue = (
    <span className="flex flex-col gap-2">
      {facts.batches.map((batch) => (
        <span key={batch.id} className="inline-flex items-center gap-8">
          {facts.batchCount > 1 && (
            <span className="font-mono text-[var(--color-text-tertiary)]">
              {batchDryTons(batch)}
            </span>
          )}
          <BatchLink batch={batch} facilityId={facilityId} />
        </span>
      ))}
    </span>
  );

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

      {facts.blockers.length > 0 && (
        <Notice tone="error">
          <ul className="list-disc pl-16">
            {facts.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </Notice>
      )}

      <DerivedHeadline
        label={
          <>
            You are sending
            <InfoHint label="About the CO₂e figures">{CALCULATION_NOTE}</InfoHint>
          </>
        }
        value={facts.dryTons}
        sub="Biochar, dry mass"
      />

      <div className="grid grid-cols-1 gap-16 sm:grid-cols-2">
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
        <DetailField
          label="Reporting window"
          value={facts.reportingWindowLabel ?? "Not compiled yet"}
        />
        <DetailField
          label={facts.batchCount === 1 ? "Credit batch" : "Credit batches"}
          value={batchesValue}
        />
      </div>

      {/* Read data stays visible in both modes (R1): the remaining facts sit
          under the four lead facts as a quieter group, without row rules. */}
      <div className="grid grid-cols-1 gap-16 sm:grid-cols-2">
        {externalProjectId && (
          <DetailField
            label="Storage sites"
            value={
              <RegistryFactLink
                href={isometricRegistry.storageSites({
                  environment,
                  externalProjectId,
                })}
                label="View in Isometric"
                ariaLabel="Open storage sites in Isometric in a new tab"
              />
            }
          />
        )}
        <DetailField
          label="Traced back to"
          value={`${countLabel(facts.runCount, "production run")}, ${countLabel(facts.applicationCount, "application")}`}
        />
        <DetailField label="Durability" value={facts.durabilityLabel} />
        <DetailField label="Sampling" value={facts.samplingLabel} />
        {facts.pendingDocuments > 0 && (
          <DetailField
            label="Registry value sources"
            value={`The app uploads ${countLabel(facts.pendingDocuments, "file")} when you submit`}
          />
        )}
      </div>

      {facts.checksAttention > 0 && (
        <SubmissionChecks checks={checks} facilityId={facilityId} />
      )}

      {facts.warnings.length > 0 && (
        <Notice tone="warning" title="Submission notes">
          <CompilationWarnings warnings={facts.warnings} />
        </Notice>
      )}

      {facts.isProduction && <EnvBanner isProduction variant="inline" />}
    </div>
  );
}
