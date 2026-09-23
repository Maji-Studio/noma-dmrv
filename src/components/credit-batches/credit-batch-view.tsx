/**
 * Credit-batch side-sheet view mode — the sections config for EntitySideSheet.
 *
 * One question drives the order: is this batch ready to become credits, and
 * what needs fixing if not? Certification progress leads, then the batch's
 * identity (mirroring the edit form's section titles), the member production
 * runs, and notes. The interactive certification checklist and lab-sample
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
import {
  certificationRemovalsHref,
  productionRunDeepLinkHref,
} from "@/lib/certification/links";

/** Who turns the input quantities into a deduction. One sentence, not a rule. */
const CARBON_ESTIMATE_BASIS =
  "Isometric applies the emission factors to these quantities at submission. noma submits the quantities only.";

function formatInput(value: number | null, unit: string): string {
  return value == null
    ? MISSING_VALUE.notRecorded
    : `${Math.round(value).toLocaleString()} ${unit}`;
}

/**
 * Carbon estimate — one headline figure with the inputs behind it.
 *
 * The estimate is the only thing an operator reads off this block, so it is the
 * only thing with size, and the one part Simple keeps. The physical inputs the registry turns into deductions
 * are the arithmetic behind it, not a competing list, so they sit under `Show
 * calculation` as label and figure rows.
 *
 * There is no gross-to-net chain to draw here: noma submits input quantities
 * and Isometric applies the emission factors (ADR 0018, ADR 0020), so no local
 * emission figure exists to subtract. The caption says whose number is missing
 * rather than inventing one.
 */
function CreditBatchCarbonLedger({
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
  const inputRows = [
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
  const runsPending = Boolean(runsError) || isLoadingRuns;

  return (
    <CompositionCard
      title="Carbon estimate"
      hint="A local estimate of stored CO₂e before project emissions. The registry result is authoritative."
      simple="headline"
      calculation={
        <div className="space-y-8">
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
      actions={
        !runsPending && productionRuns.length > 0 ? (
          <span className="flex flex-wrap items-baseline gap-x-12 gap-y-4 body-caption">
            <span className="text-[var(--color-text-tertiary)]">Source runs</span>
            {productionRuns.map(run => (
              <Link
                key={run.id}
                href={productionRunDeepLinkHref(run.id, creditBatch.facilityId)}
                className="underline-offset-4 hover:underline"
              >
                {formatDate(run.date)}
              </Link>
            ))}
          </span>
        ) : undefined
      }
      headline={<DerivedHeadline
        value={estimate == null ? null : `≈ ${formatTonnes(estimate, { unit: "t CO₂e" })}`}
        sub="Estimated CO₂e stored, before project emissions"
      />}
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
      title: "Carbon ledger",
      detailedOnly: true,
      fields: [],
      content: (
        <CreditBatchCarbonLedger
          creditBatch={creditBatch}
          productionRuns={productionRuns}
          isLoadingRuns={isLoadingRuns}
          runsError={runsError}
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
