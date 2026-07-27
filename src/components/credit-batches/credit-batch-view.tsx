/**
 * Credit-batch side-sheet view mode — the sections config for EntitySideSheet.
 *
 * One question drives the order: is this batch ready to become credits, and
 * what needs fixing if not? Certification progress leads, then the batch's
 * identity (mirroring the edit form's section titles), the member production
 * runs, and notes. The interactive certification checklist and lab-sample
 * panels mount below via `viewModeChildren` because they fetch their own data.
 */
import Link from "next/link";
import { ArrowRightIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import type { CreditBatchHealthSummary } from "@/fn/certification";
import type {
  CreditBatchProductionRunOption,
  CreditBatchWithRelations,
} from "@/data-access/credit-batches";
import { formatDate, formatTonnes } from "@/lib/format-utils";
import { CreditBatchLifecycleSteps } from "./credit-batch-lifecycle";
import { COMPLETED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";

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
    <Link
      href={`/production-runs?facility=${facilityId}&run=${run.id}`}
      className="group flex min-w-0 items-center justify-between gap-12 border border-[var(--color-border-tertiary)] bg-[var(--color-background-white)] px-12 py-10 hover:border-[var(--color-border-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
    >
      <span className="flex min-w-0 flex-col gap-2">
        <span className="body-small font-medium text-[var(--color-text-primary)]">
          {run.code}
        </span>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {formatDate(run.date)}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-10">
        {run.status !== COMPLETED_PRODUCTION_RUN_STATUS && (
          <StatusBadge status={run.status} size="small" />
        )}
        <span className="text-right">
          <span className="block label-micro text-[var(--color-text-tertiary)]">
            Dry output
          </span>
          <span className="block body-small tabular-nums text-[var(--color-text-secondary)]">
            {run.biocharDryMassKg == null
              ? "—"
              : formatTonnes(run.biocharDryMassKg / 1000)}
          </span>
        </span>
        <ArrowRightIcon
          size={14}
          className="text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-secondary)]"
          aria-hidden
        />
      </span>
    </Link>
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
      {productionRuns.map((run) => (
        <ProductionRunLink
          key={run.id}
          run={run}
          facilityId={creditBatch.facilityId}
        />
      ))}
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
  const co2eStored = creditBatch.co2eStoredPreview?.co2eStoredTonnes ?? null;

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
        {
          label: "CO₂e stored",
          value:
            co2eStored == null
              ? "Needs inputs"
              : formatTonnes(co2eStored, { unit: "t CO₂e" }),
        },
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
