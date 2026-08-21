/**
 * Credit-batch side-sheet view mode — the sections config for EntitySideSheet.
 *
 * One question drives the order: is this batch ready to become credits, and
 * what needs fixing if not? Certification progress leads, then the batch's
 * identity (mirroring the edit form's section titles), the member production
 * runs, and notes. The interactive certification checklist and lab-sample
 * panels mount below via `viewModeChildren` because they fetch their own data.
 */
import { WarningIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import type { CreditBatchHealthSummary } from "@/fn/certification";
import type {
  CreditBatchProductionRunOption,
  CreditBatchWithRelations,
} from "@/data-access/credit-batches";
import { formatDate, formatTonnes } from "@/lib/format-utils";
import { formatWetDryMass } from "@/lib/mass-moisture";
import { CreditBatchLifecycleSteps } from "./credit-batch-lifecycle";
import { SheetLinkRow, SheetLinkRows } from "./sheet-link-row";
import { COMPLETED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import { computeCohortInputTotals } from "./cohort-input-ledger";
import {
  certificationRemovalsHref,
  productionRunDeepLinkHref,
} from "@/lib/certification/links";

function formatInput(value: number | null, unit: string): string {
  return value == null
    ? MISSING_VALUE.notRecorded
    : `${Math.round(value).toLocaleString()} ${unit}`;
}

function CreditBatchCarbonLedger({
  creditBatch,
  productionRuns,
  isLoadingRuns,
  runsError,
  healthSummary,
}: {
  creditBatch: CreditBatchWithRelations;
  productionRuns: CreditBatchProductionRunOption[];
  isLoadingRuns: boolean;
  runsError: Error | null;
  healthSummary?: CreditBatchHealthSummary;
}) {
  const totals = computeCohortInputTotals(productionRuns);
  const estimate = creditBatch.co2eStoredPreview?.co2eStoredTonnes ?? null;
  const removalId =
    creditBatch.productionEmissionsClaimedByRemovalId ??
    healthSummary?.removalId ??
    null;
  const rows = [
    {
      label: "Feedstock, dry mass",
      value:
        totals.feedstockDryKg == null
          ? MISSING_VALUE.notRecorded
          : formatTonnes(kgToTonnes(totals.feedstockDryKg)),
    },
    { label: "Diesel", value: formatInput(totals.dieselLiters, "L") },
    {
      label: "Grid electricity",
      value: formatInput(totals.electricityKwh, "kWh"),
    },
  ];

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-background-white)]">
      <div className="flex flex-col gap-4 px-16 py-[14px]">
        <span className="title-heading-3 tabular-nums text-[var(--color-text-primary)]">
          {estimate == null
            ? MISSING_VALUE.notAvailable
            : `≈ ${formatTonnes(estimate, { unit: "t CO₂e" })}`}
        </span>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          Estimated CO₂e stored before project emissions and registry verification.
        </span>
      </div>
      <dl>
        {runsError || isLoadingRuns ? (
          <div className="flex items-baseline justify-between gap-12 border-t border-[var(--color-border-tertiary)] px-16 py-8">
            <dt className="body-small text-[var(--color-text-secondary)]">
              Production inputs
            </dt>
            <dd
              className="body-small text-right text-[var(--color-text-tertiary)]"
              aria-busy={isLoadingRuns || undefined}
            >
              {runsError
                ? `${MISSING_VALUE.notAvailable}. Reload the production runs to calculate these inputs.`
                : "Loading production inputs…"}
            </dd>
          </div>
        ) : rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-12 border-t border-[var(--color-border-tertiary)] px-16 py-8"
          >
            <dt className="body-small text-[var(--color-text-secondary)]">
              {row.label}
            </dt>
            <dd className="body-small font-mono tabular-nums text-[var(--color-text-primary)]">
              {row.value}
            </dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-12 border-t border-[var(--color-border-tertiary)] px-16 py-8">
          <dt className="body-small text-[var(--color-text-secondary)]">
            Production emissions
          </dt>
          <dd className="body-small text-right text-[var(--color-text-primary)]">
            {removalId ? (
              <Link
                href={certificationRemovalsHref({
                  facility: creditBatch.facilityId,
                  removal: removalId,
                })}
                className="underline-offset-4 hover:text-[var(--color-interaction)] hover:underline"
              >
                Included in Removal {removalId.slice(0, 8)}…
              </Link>
            ) : (
              "Included with the first Removal"
            )}
          </dd>
        </div>
      </dl>
      {!isLoadingRuns && !runsError && productionRuns.length > 0 && (
        <div className="border-t border-[var(--color-border-primary)] px-16 py-10">
          <p className="mb-6 body-caption text-[var(--color-text-tertiary)]">
            Source records
          </p>
          <div className="flex flex-wrap gap-x-12 gap-y-4 body-small">
            {productionRuns.map((run) => (
              <Link
                key={run.id}
                href={productionRunDeepLinkHref(
                  run.id,
                  creditBatch.facilityId,
                )}
                className="underline-offset-4 hover:text-[var(--color-interaction)] hover:underline"
              >
                {formatDate(run.date)}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function durabilityLabel(value: CreditBatchWithRelations["durabilityOption"]) {
  return value === "200_year" ? "200 years" : "1,000 years";
}

function ProductionRunLink({
  run,
  facilityId,
}: {
  run: CreditBatchProductionRunOption;
  facilityId: string;
}) {
  return (
    <SheetLinkRow
      href={productionRunDeepLinkHref(run.id, facilityId)}
      ariaLabel={`Open production run from ${formatDate(run.date)}${
        run.biocharStorageName ? ` in ${run.biocharStorageName}` : ""
      }`}
      primary={formatDate(run.date)}
      secondary={run.biocharStorageName}
      meta={
        <>
          {run.status !== COMPLETED_PRODUCTION_RUN_STATUS && (
            <StatusBadge status={run.status} size="small" />
          )}
          <span className="body-caption tabular-nums text-[var(--color-text-tertiary)]">
            {formatWetDryMass({
              wetKg: run.biocharOutputKg,
              dryKg: run.biocharDryMassKg,
            })}
          </span>
        </>
      }
    />
  );
}

interface CreditBatchRunsContentProps {
  creditBatch: CreditBatchWithRelations;
  productionRuns: CreditBatchProductionRunOption[];
  isLoadingRuns: boolean;
  runsError: Error | null;
  isRetryingRuns: boolean;
  onRetryRuns: () => void;
}

function CreditBatchRunsContent({
  creditBatch,
  productionRuns,
  isLoadingRuns,
  runsError,
  isRetryingRuns,
  onRetryRuns,
}: CreditBatchRunsContentProps) {
  if (runsError) {
    return (
      <div
        className="flex flex-col gap-10 border border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] px-12 py-10 sm:flex-row sm:items-center sm:justify-between"
        role="alert"
      >
        <span className="inline-flex items-center gap-8 body-caption text-[var(--color-text-secondary)]">
          <WarningIcon
            size={14}
            weight="fill"
            className="shrink-0 text-[var(--st-wait)]"
            aria-hidden
          />
          Production runs unavailable. Retry to load the linked runs.
        </span>
        <Button
          variant="weak"
          size="small"
          busy={isRetryingRuns}
          onClick={onRetryRuns}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (isLoadingRuns) {
    return (
      <span className="body-caption text-[var(--color-text-tertiary)]" aria-busy>
        Loading production runs…
      </span>
    );
  }

  if (productionRuns.length === 0) {
    return (
      <span className="body-caption text-[var(--color-text-tertiary)]">
        No production runs linked.
      </span>
    );
  }

  const previewCount = productionRuns.filter(
    (run) => run.status !== COMPLETED_PRODUCTION_RUN_STATUS,
  ).length;

  return (
    <div className="flex flex-col gap-8">
      <span className="body-caption text-[var(--color-text-tertiary)]">
        {creditBatch.productionRunCount} completed
        {previewCount > 0
          ? ` · ${previewCount} ${previewCount === 1 ? "preview" : "previews"}`
          : ""}
      </span>
      <SheetLinkRows>
        {productionRuns.map((run) => (
          <ProductionRunLink
            key={run.id}
            run={run}
            facilityId={creditBatch.facilityId}
          />
        ))}
      </SheetLinkRows>
    </div>
  );
}

interface CreditBatchSheetSectionsOptions extends CreditBatchRunsContentProps {
  /** Removal/GHG lifecycle summary; undefined while loading or unavailable. */
  healthSummary?: CreditBatchHealthSummary;
  isHealthLoading: boolean;
}

export function creditBatchSheetSections({
  creditBatch,
  productionRuns,
  isLoadingRuns,
  runsError,
  isRetryingRuns,
  onRetryRuns,
  healthSummary,
  isHealthLoading,
}: CreditBatchSheetSectionsOptions): DetailPanelSection[] {
  const preview = creditBatch.co2eStoredPreview;
  const durabilityResult = preview?.applicationResults.find(
    (result) => result.fDurable != null,
  );
  return [
    {
      title: "Certification progress",
      fields: [],
      content: (
        <>
          {healthSummary ? (
            <CreditBatchLifecycleSteps summary={healthSummary} />
          ) : (
            <span
              className="body-caption text-[var(--color-text-tertiary)]"
              aria-busy={isHealthLoading || undefined}
            >
              {isHealthLoading
                ? "Loading certification progress…"
                : "Certification progress unavailable"}
            </span>
          )}
          {/* Anchor for the checklist's `#batch-details` fix link — sits just
              above the Batch definition section so the jump lands on top of
              those fields rather than past them. */}
          <span id="batch-details" className="scroll-mt-24" aria-hidden />
        </>
      ),
    },
    {
      title: "Carbon ledger",
      fields: [],
      content: (
        <CreditBatchCarbonLedger
          creditBatch={creditBatch}
          productionRuns={productionRuns}
          isLoadingRuns={isLoadingRuns}
          runsError={runsError}
          healthSummary={healthSummary}
        />
      ),
    },
    {
      // Mirrors the edit form's "Batch definition" section.
      title: "Batch definition",
      fields: [
        { label: "Feedstock type", value: creditBatch.feedstockTypeName },
        { label: "Durability", value: durabilityLabel(creditBatch.durabilityOption) },
        { label: "Start date", value: formatDate(creditBatch.startDate) },
        { label: "End date", value: formatDate(creditBatch.endDate) },
        {
          label: "Applied biochar",
          value: formatTonnes(creditBatch.appliedWeightTons),
        },
        ...(durabilityResult?.rawFDurable != null &&
        durabilityResult.fDurable != null
          ? [
              {
                label: "Raw durability estimate",
                value: `${(durabilityResult.rawFDurable * 100).toFixed(1)}%`,
              },
              {
                label: "Capped durability estimate",
                value: `${(durabilityResult.fDurable * 100).toFixed(1)}%`,
              },
              {
                label: "Durability cap applied",
                value: durabilityResult.durabilityCapped ? "Yes" : "No",
              },
              {
                label: "Preview component",
                value: preview?.componentKey ?? MISSING_VALUE.notAvailable,
              },
              {
                label: "Preview formula",
                value: preview?.formulaVersion ?? MISSING_VALUE.notAvailable,
              },
              {
                label: "Preview authority",
                value: "Local estimate. The registry result remains authoritative.",
              },
            ]
          : []),
      ],
    },
    {
      title: "Production runs",
      fields: [],
      content: (
        <CreditBatchRunsContent
          creditBatch={creditBatch}
          productionRuns={productionRuns}
          isLoadingRuns={isLoadingRuns}
          runsError={runsError}
          isRetryingRuns={isRetryingRuns}
          onRetryRuns={onRetryRuns}
        />
      ),
    },
    {
      title: "Additional information",
      fields: [{ label: "Notes", value: creditBatch.siteManagementNotes }],
    },
  ];
}
