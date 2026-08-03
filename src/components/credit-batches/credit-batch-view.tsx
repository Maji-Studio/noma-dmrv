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
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { InfoHint } from "@/components/ui/tooltip";
import { carbonGapLabels } from "@/lib/certification/batch-health-facts";
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
      href={`/production-runs?facility=${facilityId}&run=${run.id}`}
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
  /** The CO₂e-stored preview query is still in flight. */
  isCo2ePreviewLoading?: boolean;
  /** The CO₂e-stored preview query failed — the figure is unknown, not absent. */
  co2ePreviewFailed?: boolean;
}

/**
 * The "CO₂e stored" cell. The figure comes from a separate preview query, so an
 * absent value has three very different meanings — still loading, failed to
 * load, or genuinely not computable yet — and the old blanket "Needs inputs"
 * covered all three while naming none of them (and read as a contradiction next
 * to a batch whose checks all passed).
 */
function co2eStoredValue({
  creditBatch,
  isCo2ePreviewLoading,
  co2ePreviewFailed,
}: {
  creditBatch: CreditBatchWithRelations;
  isCo2ePreviewLoading?: boolean;
  co2ePreviewFailed?: boolean;
}): React.ReactNode {
  const preview = creditBatch.co2eStoredPreview;

  if (preview?.co2eStoredTonnes != null) {
    return formatTonnes(preview.co2eStoredTonnes, { unit: "t CO₂e" });
  }
  if (!preview) {
    if (isCo2ePreviewLoading) return "Calculating…";
    if (co2ePreviewFailed) return "Not available";
    return "Not available";
  }

  const gaps = carbonGapLabels(preview.missingInputs);
  return (
    <span className="inline-flex items-center gap-6">
      Not calculable yet
      <InfoHint label="Why there is no CO₂e figure">
        {gaps.length > 0
          ? `This figure needs ${formatList(gaps)}. Fix it under Certification requirements below.`
          : "This figure is waiting on data that hasn't been recorded yet. Certification requirements below lists what is outstanding."}
      </InfoHint>
    </span>
  );
}

/** "A", "A and B", "A, B and C" — for reading a gap list inside a sentence. */
function formatList(items: string[]): string {
  const lower = items.map(
    (item) => item.charAt(0).toLowerCase() + item.slice(1),
  );
  if (lower.length <= 1) return lower[0] ?? "";
  return `${lower.slice(0, -1).join(", ")} and ${lower[lower.length - 1]}`;
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
  isCo2ePreviewLoading,
  co2ePreviewFailed,
}: CreditBatchSheetSectionsOptions): DetailPanelSection[] {
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
          value: co2eStoredValue({
            creditBatch,
            isCo2ePreviewLoading,
            co2ePreviewFailed,
          }),
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
