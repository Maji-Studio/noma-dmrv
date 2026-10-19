"use client";

/** The credit batch page header: identity, the state-driven action, progress and key numbers. */
import Link from "next/link";
import {
  ArrowLeftIcon,
  CheckIcon,
  DotsThreeIcon,
  LeafIcon,
  PencilSimpleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useBatchDurabilitySummary } from "@/hooks/use-certification";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import { creditBatchListHref } from "@/lib/certification/batch-health-links";
import { traceabilityBatchHref } from "@/lib/certification/links";
import { MISSING_VALUE } from "@/lib/copy-utils";
import {
  APPLIED_DRY_LABEL,
  creditBatchMilestones,
  type CreditBatchMilestone,
  type CreditBatchPrimaryAction,
} from "@/lib/credit-batches/batch-page";
import { formatDateRange, formatTonnes } from "@/lib/format-utils";
import { isRecordEditable } from "@/lib/record-lock-view";
import { cn } from "@/lib/utils";
import { isCreditBatchDeletable } from "./credit-batch-card";
import { useCreditBatchPage } from "./credit-batch-page-context";
import { CountBadge, IdentityChip, MUTED_TEXT } from "./credit-batch-page-parts";
import { CREDIT_BATCH_PROGRESS_TITLE, CreditBatchProgressCompact } from "./credit-batch-progress-compact";
import { carbonEstimateGap } from "./credit-batch-view";

export interface CreditBatchHeaderActions {
  primary: CreditBatchPrimaryAction | null;
  onPrimary: (action: CreditBatchPrimaryAction) => void;
  onDelete: () => void;
}

function OverflowMenu({ onDelete }: { onDelete: () => void }) {
  const { batch, lock } = useCreditBatchPage();
  const deletable = isRecordEditable(lock) && isCreditBatchDeletable(lock);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger render={<Button variant="weak" width="square" aria-label="More actions for this credit batch" />}>
        <DotsThreeIcon size={20} weight="bold" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.Item render={<Link href={traceabilityBatchHref(batch.id, batch.facilityId)} />}>
          Open in Traceability
        </DropdownMenu.Item>
        {deletable && (
          <>
            <DropdownMenu.Separator />
            <DropdownMenu.Item destructive onClick={onDelete}>Delete credit batch</DropdownMenu.Item>
          </>
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

const STEP_BAR: Record<CreditBatchMilestone["state"], string> = {
  done: "bg-[var(--st-ok)]",
  current: "bg-[var(--ink)]",
  failed: "bg-[var(--st-bad)]",
  todo: "bg-[var(--color-border-tertiary)]",
};

/**
 * The four milestones as segments: a bar, the step and what it is at. Four
 * across from `sm`; below it, where they would wrap, one compact row that
 * opens the same four in a popover.
 */
function ProgressSteps() {
  const { pageModel, blockingCount } = useCreditBatchPage();
  const steps = creditBatchMilestones({ blockingCount, pageModel });
  return (
    <>
      <CreditBatchProgressCompact steps={steps} className="sm:hidden" />
      <ol className="hidden grid-cols-4 gap-x-4 sm:grid" aria-label={CREDIT_BATCH_PROGRESS_TITLE}>
        {steps.map((step) => (
          <li key={step.key} aria-current={step.state === "current" ? "step" : undefined} className="flex min-w-0 flex-col gap-8">
            <span aria-hidden className={cn("h-4 w-full", STEP_BAR[step.state])} />
            <span className="flex min-w-0 flex-col gap-2 pr-12">
              <span className={cn("inline-flex flex-wrap items-center gap-6 body-small", step.state === "todo" ? MUTED_TEXT : "font-medium")}>
                {step.state === "done" && <CheckIcon size={16} weight="bold" className="shrink-0 text-[var(--st-ok)]" aria-hidden />}
                {step.state === "failed" && <WarningCircleIcon size={16} weight="bold" className="shrink-0 text-[var(--st-bad)]" aria-hidden />}
                {step.label}
                {step.state === "done" && <span className="sr-only"> (done)</span>}
                {step.count != null && <CountBadge count={step.count} blocking label={`${step.count} blocking ${step.count === 1 ? "item" : "items"}`} />}
              </span>
              {step.caption && <span className={cn("body-caption", step.state === "failed" ? "text-[var(--st-bad)]" : MUTED_TEXT)}>{step.caption}</span>}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

function HeaderButtons({ primary, onPrimary, onDelete }: CreditBatchHeaderActions) {
  const { startEdit } = useCreditBatchPage();
  return (
    <>
      {primary && (
        <Button variant="primary" onClick={() => onPrimary(primary)}>
          {primary.label}
        </Button>
      )}
      {startEdit && (
        <Button variant="default" onClick={startEdit}>
          <PencilSimpleIcon size={20} aria-hidden />
          Edit
        </Button>
      )}
      <OverflowMenu onDelete={onDelete} />
    </>
  );
}

export function CreditBatchPageHeader(actions: CreditBatchHeaderActions) {
  const { batch } = useCreditBatchPage();
  return (
    <div className="flex flex-col gap-20">
      <Link
        href={creditBatchListHref(batch.facilityId)}
        className={cn("inline-flex min-h-44 items-center gap-6 self-start body-small underline-offset-2 hover:underline", MUTED_TEXT)}
      >
        <ArrowLeftIcon size={16} aria-hidden />
        All credit batches
      </Link>
      <div className="flex flex-col gap-24">
        <div className="flex flex-col gap-12">
          <PageHeader area="verification" title={batch.code} actions={<HeaderButtons {...actions} />} />
          <div className="flex flex-wrap items-center gap-12">
            {batch.feedstockTypeName && <IdentityChip icon={<LeafIcon size={16} aria-hidden />}>{batch.feedstockTypeName}</IdentityChip>}
            <span className={cn("body-small", MUTED_TEXT)}>{formatDateRange(batch.startDate, batch.endDate)}</span>
          </div>
        </div>
        <ProgressSteps />
      </div>
    </div>
  );
}

const VALUE_SKELETON_WIDTH_PX = 88;
const VALUE_SKELETON_HEIGHT_PX = 28;

interface KeyNumber {
  label: string;
  /** Null while its query loads: a skeleton, never a missing-value token. */
  value: string | null;
  sub: string | null;
}

function appliedNumber(pageModel: ReturnType<typeof useCreditBatchPage>["pageModel"], failed: boolean): KeyNumber {
  if (!pageModel && failed) return { label: APPLIED_DRY_LABEL, value: MISSING_VALUE.notAvailable, sub: null };
  if (!pageModel) return { label: APPLIED_DRY_LABEL, value: null, sub: null };
  const { appliedDryKg, notInRemovalDryKg } = pageModel.mass;
  let sub: string | null = null;
  if (notInRemovalDryKg > 0) sub = `${formatTonnes(kgToTonnes(notInRemovalDryKg))} not in a Removal`;
  else if (pageModel.removals.length > 0) sub = "All in Removals";
  return { label: APPLIED_DRY_LABEL, value: formatTonnes(kgToTonnes(appliedDryKg)), sub };
}

/** Three figures an operator checks first. Open items live in the Overview badge and list. */
export function CreditBatchKeyNumbers() {
  const { batch, pageModel, pageModelError } = useCreditBatchPage();
  const durability = useBatchDurabilitySummary(batch.id);
  const estimate = batch.co2eStoredPreview?.co2eStoredTonnes ?? null;
  const summary = durability.data;
  const sampled = summary?.sampling !== "unsampled";
  const cells: KeyNumber[] = [
    appliedNumber(pageModel, !!pageModelError),
    {
      label: "Carbon estimate",
      value: estimate == null ? MISSING_VALUE.notAvailable : `≈ ${formatTonnes(estimate, { unit: "t CO₂e" })}`,
      sub: estimate == null ? carbonEstimateGap(batch.co2eStoredPreview?.missingInputs ?? []) : "Before project emissions",
    },
    {
      label: "Samples",
      value: !summary ? (durability.isError ? MISSING_VALUE.notAvailable : null) : sampled ? `${summary.usableReplicateCount} of ${summary.minimumReplicates}` : String(summary.sampleCount),
      sub: !summary
        ? null
        : !sampled
          ? "Unsampled credit batch"
          : summary.usableReplicateCount >= summary.minimumReplicates
            ? "Enough for a sampled credit batch"
            : `A sampled credit batch needs ${summary.minimumReplicates}`,
    },
  ];
  return (
    <dl className="grid grid-cols-1 border border-[var(--color-border-secondary)] bg-[var(--paper)] sm:grid-cols-3">
      {cells.map((cell) => (
        <div
          key={cell.label}
          className="flex items-baseline justify-between gap-12 border-t border-[var(--color-border-tertiary)] px-16 py-12 first:border-t-0 sm:flex-col sm:items-start sm:justify-start sm:gap-4 sm:border-t-0 sm:border-l sm:p-20 sm:first:border-l-0"
        >
          <dt className={cn("body-small", MUTED_TEXT)}>{cell.label}</dt>
          <dd className="flex min-w-0 flex-col items-end gap-2 text-right sm:items-start sm:text-left">
            {cell.value == null ? (
              <Skeleton width={VALUE_SKELETON_WIDTH_PX} height={VALUE_SKELETON_HEIGHT_PX} />
            ) : (
              <span className="title-heading-3 tabular-nums">{cell.value}</span>
            )}
            {cell.sub && <span className={cn("body-caption", MUTED_TEXT)}>{cell.sub}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
