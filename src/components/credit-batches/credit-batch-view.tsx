/**
 * Credit-batch side-sheet view mode — the sections config for EntitySideSheet.
 *
 * One question drives the order: is this batch ready to become credits, and
 * what needs fixing if not? Certification progress leads, then the batch's
 * identity (mirroring the edit form's section titles), the member production
 * runs closed by the carbon estimate they produce, and notes. The interactive certification checklist and lab-sample
 * panels mount below via `viewModeChildren` because they fetch their own data.
 */
import { CompositionCard, DerivedHeadline } from "@/components/forms";
import { DetailedOnly } from "@/components/forms/form-detail-context";
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
import { StockRows } from "@/components/storage-locations/stock-figures";
import { formatDate, formatTonnes } from "@/lib/format-utils";
import { formatWetDryMass } from "@/lib/mass-moisture";
import { CreditBatchLifecycleSteps } from "./credit-batch-lifecycle";
import { SheetLinkRow, SheetLinkRows } from "./sheet-link-row";
import { COMPLETED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import { computeCohortInputTotals } from "./cohort-input-ledger";
import { carbonGapLabels } from "@/lib/certification/batch-health-facts";
import { STORED_CO2E_PREVIEW_REVERIFICATION_GAP } from "@/lib/certification/preview-gaps";
import {
  certificationRemovalsHref,
  productionRunDeepLinkHref,
} from "@/lib/certification/links";

/** Names the figure, so the headline needs no label of its own. */
const CARBON_ESTIMATE_TITLE = "Carbon estimate, before project emissions";
const CARBON_ESTIMATE_HINT =
  "A local estimate of stored CO₂e before project emissions. The registry result is authoritative.";
/** What the input rows are to the estimate above them. */
const CARBON_ESTIMATE_BASIS =
  "These inputs are not in the estimate. Isometric turns them into project emissions at submission.";

/**
 * Why the estimate is missing, as one caption under the empty figure. Setup
 * gaps come first because they block every other input.
 */
function carbonEstimateGap(missingInputs: readonly string[]): string | null {
  if (missingInputs.includes("facilityCertifierProject")) return "No certifier project is linked to this facility.";
  if (missingInputs.includes("isometricCertifier")) return "Estimates are available for Isometric projects only.";
  if (missingInputs.includes(STORED_CO2E_PREVIEW_REVERIFICATION_GAP)) return "Paused for 200-year batches until the soil storage module is re-verified.";
  if (missingInputs.includes("applicationIds")) return "No applications recorded for this batch yet.";
  const gaps = carbonGapLabels(missingInputs);
  return gaps.length > 0 ? `Missing: ${gaps.join(", ")}.` : null;
}

function formatInput(value: number | null, unit: string): string {
  return value == null
    ? MISSING_VALUE.notRecorded
    : `${Math.round(value).toLocaleString()} ${unit}`;
}

/**
 * Carbon estimate: one headline figure with the inputs behind it.
 *
 * It closes the Production runs section because the runs listed above it are
 * what it is computed from. The figure is the only thing an operator reads off
 * the block, so it is the one part Simple keeps. The physical inputs the
 * registry turns into deductions are the arithmetic behind it, not a competing
 * list, so they sit under Show calculation as label and figure rows.
 *
 * The caption names the figure, so the headline carries no label of its own.
 * There is no gross-to-net chain to draw here: noma submits input quantities
 * and Isometric applies the emission factors (ADR 0018, ADR 0020), so no local
 * emission figure exists to subtract.
 */
function CreditBatchCarbonEstimate({
  creditBatch,
  productionRuns,
  isLoadingRuns,
  runsError,
}: {
  creditBatch: CreditBatchWithRelations;
  productionRuns: CreditBatchProductionRunOption[];
  isLoadingRuns: boolean;
  runsError: Error | null;
}) {
  const totals = computeCohortInputTotals(productionRuns);
  const estimate = creditBatch.co2eStoredPreview?.co2eStoredTonnes ?? null;
  const gap = estimate == null ? carbonEstimateGap(creditBatch.co2eStoredPreview?.missingInputs ?? []) : null;
  const inputRows = [
    {
      label: "Feedstock dry mass",
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
  const runsPending = Boolean(runsError) || isLoadingRuns;

  return (
    <CompositionCard
      title={CARBON_ESTIMATE_TITLE}
      hint={CARBON_ESTIMATE_HINT}
      simple="headline"
      headline={<DerivedHeadline
        value={estimate == null ? null : `≈ ${formatTonnes(estimate, { unit: "t CO₂e" })}`}
        sub={gap ?? undefined}
      />}
      calculation={
        <div className="flex flex-col gap-8">
          {runsPending ? (
            <StockRows
              label="Production inputs"
              rows={[{
                label: "Production inputs",
                value: (
                  <span aria-busy={isLoadingRuns || undefined} className="text-[var(--color-text-tertiary)]">
                    {runsError ? `${MISSING_VALUE.notAvailable}. Reload the production runs.` : "Loading…"}
                  </span>
                ),
              }]}
            />
          ) : (
            <StockRows label="Production inputs claimed by this batch" rows={inputRows} />
          )}
          <p className="body-caption text-[var(--color-text-tertiary)]">
            {CARBON_ESTIMATE_BASIS}
          </p>
        </div>
      }
    />
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
          <DetailedOnly><span className="body-caption tabular-nums text-[var(--color-text-tertiary)]">
            {formatWetDryMass({
              wetKg: run.biocharOutputKg,
              dryKg: run.biocharDryMassKg,
            })}
          </span></DetailedOnly>
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
          ? `, ${previewCount} ${previewCount === 1 ? "preview" : "previews"}`
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
  const removalId = creditBatch.productionEmissionsClaimedByRemovalId ?? healthSummary?.removalId ?? null;
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
          {removalId && <Link href={certificationRemovalsHref({ facility: creditBatch.facilityId, removal: removalId })} className="body-small underline">Production emissions included in Removal {removalId.slice(0, 8)}…</Link>}
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
          detailedOnly: true,
          value: formatTonnes(creditBatch.appliedWeightTons),
        },
        ...(durabilityResult?.rawFDurable != null &&
        durabilityResult.fDurable != null
          ? [
              {
                label: "Raw durability estimate",
                detailedOnly: true,
                value: `${(durabilityResult.rawFDurable * 100).toFixed(1)}%`,
              },
              {
                label: "Capped durability estimate",
                detailedOnly: true,
                value: `${(durabilityResult.fDurable * 100).toFixed(1)}%`,
              },
              {
                label: "Durability cap applied",
                detailedOnly: true,
                value: durabilityResult.durabilityCapped ? "Yes" : "No",
              },
              {
                label: "Preview component",
                detailedOnly: true,
                value: preview?.componentKey ?? MISSING_VALUE.notAvailable,
              },
              {
                label: "Preview formula",
                detailedOnly: true,
                value: preview?.formulaVersion ?? MISSING_VALUE.notAvailable,
              },
            ]
          : []),
      ],
    },
    {
      title: "Production runs",
      fields: [],
      content: (
        <div className="flex flex-col gap-16">
          <CreditBatchRunsContent
            creditBatch={creditBatch}
            productionRuns={productionRuns}
            isLoadingRuns={isLoadingRuns}
            runsError={runsError}
            isRetryingRuns={isRetryingRuns}
            onRetryRuns={onRetryRuns}
          />
          <CreditBatchCarbonEstimate
            creditBatch={creditBatch}
            productionRuns={productionRuns}
            isLoadingRuns={isLoadingRuns}
            runsError={runsError}
          />
        </div>
      ),
    },
    {
      title: "Additional information",
      fields: [{ label: "Notes", value: creditBatch.siteManagementNotes }],
    },
  ];
}
