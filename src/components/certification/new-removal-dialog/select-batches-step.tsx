/**
 * SelectBatchesStep — step 1 of the New-Removal wizard, reshaped as a readiness
 * workspace (design doc §4.1–4.2, Phase 2). Ready batches lead as selectable
 * cards; not-ready batches collapse under a "Not ready yet (N)" disclosure so the
 * happy path is what the operator sees first. Each gap on a not-ready batch is an
 * action that deep-links straight to where it's fixed (lab samples, production
 * runs, deliveries) — the same `batchHealthFixLinkFor` targets the batch page
 * uses, so the two never diverge — opened in a new tab so this workspace stays
 * put. No more diagnosis-only dead-end: even with zero ready batches the operator
 * has a concrete next click on every gap.
 *
 * When facility setup is incomplete a banner blocks grouping for the whole
 * facility — there's no registry to submit to without it (§8).
 */
"use client";

import Link from "next/link";
import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CheckCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { formatDateRange, formatTonnes } from "@/lib/format-utils";
import { InfoHint } from "@/components/ui/tooltip";
import { batchHealthFixLinkFor } from "@/lib/certification/batch-health-links";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { certificationSettingsHref } from "@/lib/certification/links";
import { CREDIT_BATCH_READY_LABEL } from "@/lib/certification/credit-batch-lifecycle";
import {
  facilityBlueprintLabel,
  type FacilitySetupGap,
} from "@/lib/certification/facility-setup-gaps";
import { formatDurabilityOption } from "@/schemas/credit-batches";
import type { SelectableBatch } from "@/fn/certification";

interface SelectBatchesStepProps {
  batches: SelectableBatch[];
  facilitySetupGaps: FacilitySetupGap[];
  facilityId: string;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Plain-language copy for one structured setup gap: what exactly is unmet and
 * where it is fixed. Only the gaps that ARE about the project link / template
 * send the operator to certification settings — an unresolved blueprint on an
 * already-linked facility names the blueprint keys instead of issuing a false
 * "link this facility" instruction (QA 2026-07-21 F2).
 */
export function setupGapCopy(gap: FacilitySetupGap): {
  message: string;
  action: { label: string; toSettings: true } | null;
} {
  switch (gap.kind) {
    case "project_link":
      return {
        message:
          "This facility isn't linked to an Isometric project yet. Link it before grouping batches.",
        action: { label: "Link facility in certification settings", toSettings: true },
      };
    case "credentials":
      return {
        message:
          "The organization's registry connection credentials are not set, so the registry cannot be reached. Ask an Owner or Admin to add them before linking this facility.",
        action: null,
      };
    case "default_template":
      return {
        message:
          "This facility is linked, but no default Removal template is set for it.",
        action: { label: "Choose a template in certification settings", toSettings: true },
      };
    case "template_resolution":
      return {
        message: `The configured Removal template (${gap.templateId}) is no longer available in the registry. Select another template.`,
        action: { label: "Re-select template in certification settings", toSettings: true },
      };
    case "blueprint_keys": {
      const labels = gap.keys.map(facilityBlueprintLabel);
      return {
        message:
          `The selected Removal template uses ${gap.keys.length} ` +
          `${gap.keys.length === 1 ? "component" : "components"} the registry cannot load: ` +
          `${labels.join(", ")}. Choose another template or ask an Admin to update the Isometric project.`,
        action: { label: "Review certification settings", toSettings: true },
      };
    }
  }
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <span className="body-caption text-[var(--color-text-tertiary)]">
        {label}
      </span>
      <span className="body-small text-[var(--color-text-primary)] truncate">
        {value}
      </span>
    </div>
  );
}


function ReadyCard({
  batch,
  selected,
  onToggle,
}: {
  batch: SelectableBatch;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <label
      className={`flex cursor-pointer flex-col gap-12 border bg-[var(--color-background-white)] p-16 transition-colors ${
        selected
          ? "border-[var(--color-interaction)]"
          : "border-[var(--color-border-secondary)] hover:border-[var(--color-border-primary)]"
      }`}
    >
      <div className="flex items-start justify-between gap-12">
        <span className="body-small font-mono text-[var(--color-text-primary)]">
          {batch.code}
        </span>
        <input
          type="checkbox"
          className="mt-px size-16 shrink-0 accent-[var(--color-interaction)]"
          checked={selected}
          onChange={() => onToggle(batch.id)}
          aria-label={`Select credit batch ${batch.code}`}
        />
      </div>
      <span className="body-caption text-[var(--color-text-tertiary)]">
        {formatDateRange(batch.startDate, batch.endDate)}
      </span>
      <div className="grid grid-cols-2 gap-8">
        <Metric label="Weight" value={formatTonnes(batch.appliedWeightTons)} />
        <Metric
          label="Durability"
          value={formatDurabilityOption(batch.durabilityOption)}
        />
      </div>
      <span className="inline-flex items-center gap-6 body-caption font-medium text-[var(--st-ok)]">
        <CheckCircleIcon size={14} weight="fill" aria-hidden />
        {CREDIT_BATCH_READY_LABEL}
      </span>
    </label>
  );
}

function IncompleteCard({
  batch,
  facilityId,
}: {
  batch: SelectableBatch;
  facilityId: string;
}) {
  // The unmet checks, each with the exact missing items — shown inline so the
  // operator sees precisely what's outstanding without leaving the dialog. Every
  // gap carries its own deep link to the exact fix, so there's forward motion on
  // each one rather than a single "go fix it elsewhere" hop (design doc §4.1).
  const gaps = batch.health.checks.filter((c) => c.status === "unmet");
  return (
    <div className="flex flex-col gap-12 border border-[var(--color-border-tertiary)] bg-[var(--color-surface-light)] p-16">
      <div className="flex items-start justify-between gap-12">
        <span className="body-small font-mono text-[var(--color-text-secondary)]">
          {batch.code}
        </span>
        <span className="inline-flex items-center gap-6 body-caption font-medium text-[var(--color-signal-orange-strong)]">
          <WarningIcon size={14} weight="fill" aria-hidden />
          {batch.health.issueCount}{" "}
          {batch.health.issueCount === 1 ? "issue" : "issues"}
        </span>
      </div>
      <span className="body-caption text-[var(--color-text-tertiary)]">
        {formatDateRange(batch.startDate, batch.endDate)}
      </span>
      <ul className="flex flex-col gap-10">
        {gaps.map((check, index) => {
          // The exact fix workflow for this gap — the same target map the batch
          // page's health strip uses (batch→samples, run→readings, application→
          // deliveries), so a gap resolves identically wherever it's shown.
          const fix = batchHealthFixLinkFor(check, facilityId, batch.id);
          return (
            <li
              key={`${check.key}:${check.issueKey ?? index}`}
              className="flex flex-col gap-4"
            >
              {/* One plain-language requirement string, identical to the batch
                  page's checklist (Phase 0) — never the affirmative "…complete"
                  label next to a "Missing:" line. Protocol reasoning sits behind
                  the ⓘ "Why?" (Phase 1). */}
              <span className="inline-flex items-center gap-6 body-caption font-medium text-[var(--color-text-secondary)]">
                {check.requirementLabel}
                {check.whyDetail && (
                  <InfoHint label="Why is this required?">
                    {check.whyDetail}
                  </InfoHint>
                )}
              </span>
              {check.detail && (
                <span className="body-caption text-[var(--color-text-tertiary)]">
                  {check.detail}
                </span>
              )}
              {/* New tab: the fix opens alongside so this readiness workspace
                  stays put — the operator resolves the gap and returns here. */}
              <Link
                href={fix.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-4 self-start body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline"
              >
                {fix.label}
                <ArrowSquareOutIcon size={12} aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
      <Link
        href={creditBatchDeepLinkHref(batch.id, facilityId)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-4 self-start body-caption text-[var(--color-text-tertiary)] underline-offset-2 hover:text-[var(--color-text-secondary)] hover:underline"
      >
        Open full checklist on batch page
        <ArrowSquareOutIcon size={12} aria-hidden />
      </Link>
    </div>
  );
}

export function SelectBatchesStep({
  batches,
  facilitySetupGaps,
  facilityId,
  selectedIds,
  onToggle,
  isLoading,
  isError,
}: SelectBatchesStepProps) {
  const readyBatches = batches.filter((b) => b.health.state === "ready");
  const notReadyBatches = batches.filter((b) => b.health.state !== "ready");
  const hasBatches = batches.length > 0;

  return (
    <div className="flex flex-col gap-16">
      <h3 className="title-heading-3 flex items-center gap-6">
        Select credit batches
        <InfoHint>
          Only batches whose data is complete can be grouped into a Removal.
        </InfoHint>
      </h3>

      {/* Setup gaps render only once the readiness query has settled — a
          loading default must not flash a false "finish setup" instruction. */}
      {!isLoading &&
        facilitySetupGaps.map((gap) => {
          const copy = setupGapCopy(gap);
          return (
            <div
              key={gap.kind}
              className="flex items-start gap-12 border-l-4 border-[var(--color-signal-orange)] bg-[var(--color-signal-orange-light)] px-12 py-8"
            >
              <WarningIcon
                size={16}
                weight="fill"
                aria-hidden
                className="mt-px shrink-0 text-[var(--color-signal-orange-strong)]"
              />
              <div className="flex flex-col gap-2">
                <span className="body-small text-[var(--color-text-primary)]">
                  {copy.message}
                </span>
                {copy.action && (
                  <Link
                    href={certificationSettingsHref(facilityId)}
                    className="inline-flex items-center gap-4 body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline"
                  >
                    {copy.action.label}
                    <ArrowSquareOutIcon size={12} aria-hidden />
                  </Link>
                )}
              </div>
            </div>
          );
        })}

      {isLoading ? (
        <p className="body-small text-[var(--color-text-tertiary)]">
          Loading credit batches…
        </p>
      ) : isError ? (
        <p className="body-small text-[var(--color-signal-red)]" role="alert">
          Couldn&apos;t load credit batches. Try again.
        </p>
      ) : !hasBatches ? (
        <p className="body-small text-[var(--color-text-tertiary)]">
          No ungrouped credit batches in this facility.
        </p>
      ) : (
        <div className="flex flex-col gap-16">
          {/* Ready batches lead — the happy path (design doc §4.2). */}
          {readyBatches.length > 0 && (
            <div className="grid grid-cols-1 gap-12 sm:grid-cols-2">
              {readyBatches.map((batch) => (
                <ReadyCard
                  key={batch.id}
                  batch={batch}
                  selected={selectedIds.has(batch.id)}
                  onToggle={onToggle}
                />
              ))}
            </div>
          )}

          {/* With nothing ready this isn't a dead-end: name the situation and
              point at the gaps, which are actionable one click each below. */}
          {readyBatches.length === 0 && (
            <p className="body-small text-[var(--color-text-secondary)]">
              No batches have complete data yet. Resolve the gaps below and
              they&apos;ll move up here.
            </p>
          )}

          {/* Not-ready batches collapse away from the happy path, but open by
              default when nothing is ready so the operator lands on the work. */}
          {notReadyBatches.length > 0 && (
            <details className="group flex flex-col" open={readyBatches.length === 0}>
              <summary className="flex cursor-pointer list-none items-center gap-8 py-4 [&::-webkit-details-marker]:hidden">
                <CaretDownIcon
                  size={14}
                  aria-hidden
                  className="shrink-0 text-[var(--color-text-tertiary)] transition-transform duration-150 group-open:rotate-180"
                />
                <span className="body-small font-medium text-[var(--color-text-secondary)]">
                  Not ready yet ({notReadyBatches.length})
                </span>
              </summary>
              <div className="mt-12 grid grid-cols-1 gap-12 sm:grid-cols-2">
                {notReadyBatches.map((batch) => (
                  <IncompleteCard
                    key={batch.id}
                    batch={batch}
                    facilityId={facilityId}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
