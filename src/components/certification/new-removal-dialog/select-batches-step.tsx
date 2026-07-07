/**
 * SelectBatchesStep — step 1 of the New-Removal wizard. Lists the facility's
 * ungrouped credit batches paired with the per-batch health verdict
 * (`useSelectableBatches`). A "ready" batch is a selectable checkbox card; an
 * "incomplete" batch is non-selectable and shows its exact gaps inline (carbon,
 * production, transport, the batch's own entity certifier fields) with a link out
 * to the batch page where each is fixed — so the operator resolves everything
 * here, at selection, rather than discovering it after grouping (design doc §4).
 * When facility setup is incomplete a banner blocks grouping for the whole
 * facility — there's no registry to submit to without it (§8).
 */
"use client";

import Link from "next/link";
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { formatSafeDate, formatTonnes } from "@/lib/format-utils";
import { InfoHint } from "@/components/ui/tooltip";
import { certificationSettingsHref } from "@/lib/certification/links";
import { formatDurabilityOption } from "@/schemas/credit-batches";
import type { SelectableBatch } from "@/fn/certification";

interface SelectBatchesStepProps {
  batches: SelectableBatch[];
  facilitySetupComplete: boolean;
  facilityId: string;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  isLoading: boolean;
  isError: boolean;
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
        {formatSafeDate(batch.startDate)} — {formatSafeDate(batch.endDate)}
      </span>
      <div className="grid grid-cols-3 gap-8">
        <Metric label="Weight" value={formatTonnes(batch.appliedWeightTons)} />
        <Metric
          label="CO₂e stored"
          value={formatTonnes(batch.co2eStoredTonnes)}
        />
        <Metric
          label="Durability"
          value={formatDurabilityOption(batch.durabilityOption)}
        />
      </div>
      <span className="inline-flex items-center gap-6 body-caption font-medium text-[var(--color-signal-green)]">
        <CheckCircleIcon size={14} weight="fill" aria-hidden />
        Ready to certify
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
  // operator sees precisely what's outstanding without leaving the dialog, then
  // jumps to the batch page to resolve it.
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
        {formatSafeDate(batch.startDate)} — {formatSafeDate(batch.endDate)}
      </span>
      <ul className="flex flex-col gap-6">
        {gaps.map((check) => (
          <li key={check.key} className="flex flex-col gap-2">
            {/* One plain-language requirement string, identical to the batch
                page's checklist (Phase 0) — never the affirmative "…complete"
                label next to a "Missing:" line. */}
            <span className="body-caption font-medium text-[var(--color-text-secondary)]">
              {check.requirementLabel}
            </span>
            {check.detail && (
              <span className="body-caption text-[var(--color-text-tertiary)]">
                {check.detail}
              </span>
            )}
          </li>
        ))}
      </ul>
      <Link
        href={`/credit-batches/${batch.id}?facility=${facilityId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-4 self-start body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline"
      >
        Fix on batch page
        <ArrowSquareOutIcon size={12} aria-hidden />
      </Link>
    </div>
  );
}

export function SelectBatchesStep({
  batches,
  facilitySetupComplete,
  facilityId,
  selectedIds,
  onToggle,
  isLoading,
  isError,
}: SelectBatchesStepProps) {
  return (
    <div className="flex flex-col gap-16">
      <h3 className="title-heading-3 flex items-center gap-6">
        Select credit batches
        <InfoHint>
          Only batches whose data is complete can be grouped into a removal.
        </InfoHint>
      </h3>

      {!facilitySetupComplete && (
        <div className="flex items-start gap-12 border-l-4 border-[var(--color-signal-orange)] bg-[var(--color-signal-orange-light)] px-12 py-8">
          <WarningIcon
            size={16}
            weight="fill"
            aria-hidden
            className="mt-px shrink-0 text-[var(--color-signal-orange-strong)]"
          />
          <div className="flex flex-col gap-2">
            <span className="body-small text-[var(--color-text-primary)]">
              Link this facility to Isometric and set a removal template before
              grouping batches.
            </span>
            <Link
              href={certificationSettingsHref(facilityId)}
              className="inline-flex items-center gap-4 body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline"
            >
              Open certification settings
              <ArrowSquareOutIcon size={12} aria-hidden />
            </Link>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="body-small text-[var(--color-text-tertiary)]">
          Loading credit batches…
        </p>
      ) : isError ? (
        <p className="body-small text-[var(--color-signal-red)]" role="alert">
          Couldn&apos;t load credit batches. Try again.
        </p>
      ) : batches.length === 0 ? (
        <p className="body-small text-[var(--color-text-tertiary)]">
          No ungrouped credit batches in this facility.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-12 sm:grid-cols-2">
          {batches.map((batch) =>
            batch.health.state === "ready" ? (
              <ReadyCard
                key={batch.id}
                batch={batch}
                selected={selectedIds.has(batch.id)}
                onToggle={onToggle}
              />
            ) : (
              <IncompleteCard
                key={batch.id}
                batch={batch}
                facilityId={facilityId}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}
