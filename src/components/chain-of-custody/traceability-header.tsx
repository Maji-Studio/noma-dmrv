"use client";

import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import { Button } from "@/components/ui/button";
import { SegmentSwitch } from "@/components/ui/segment-switch";
import { cn } from "@/lib/utils";
import { BatchPicker } from "./batch-picker";
import { RunPicker, type RunPickerOption } from "./run-picker";

const FACILITY_MAX_WIDTH_CLASS = "max-w-[180px]";

// The h1 rule in styles/typography.css is unlayered, so it outranks Tailwind
// utilities; the ! overrides keep the eyebrow at micro size on the h1 element.
// This relies on --text-h1--line-height staying a percentage: it resolves
// against the overridden 10px size, so switching that token to an absolute
// length would restore the full h1 line box and blow up the header row height.
const EYEBROW_CLASS =
  "shrink-0 !font-mono !text-[10px] !font-medium uppercase !tracking-[0.14em] " +
  "text-[var(--clr-dark-purple-40)]";

const MASS_UNIT_MODES: Array<{
  value: "kg" | "pct";
  label: string;
  title: string;
}> = [
  { value: "kg", label: "kg", title: "Show mass moving along each step" },
  { value: "pct", label: "%", title: "Show each step's share of its branch" },
];

export interface TraceabilityHeaderProps {
  facility: { code: string; name: string } | null;
  batches: CreditBatchWithRelations[];
  selectedBatchId: string | null;
  batchesLoading: boolean;
  batchesError: boolean;
  batchesErrorDetail: Error | null;
  onSelectBatch: (batchId: string) => void;
  anchor: "application" | "batch" | "none";
  runOptions: RunPickerOption[];
  /** The run filter narrows lineage readings; Activity covers the whole batch. */
  showRunFilter?: boolean;
  selectedRunId: string | null;
  onRunChange: (runId: string | undefined) => void;
  runFilterDisabled: boolean;
  showBackToBatch: boolean;
  onBackToBatch: () => void;
  showMassToggle: boolean;
  massUnit: "kg" | "pct";
  onMassUnitChange: (unit: "kg" | "pct") => void;
  viewModes: Array<{ value: string; label: string }>;
  activeView: string;
  defaultView: string;
  onViewChange: (nextView: string, defaultView: string) => void;
}

/** One toolbar row that wraps only when the viewport forces it. */
export function TraceabilityHeader({
  facility,
  batches,
  selectedBatchId,
  batchesLoading,
  batchesError,
  batchesErrorDetail,
  onSelectBatch,
  anchor,
  runOptions,
  showRunFilter = true,
  selectedRunId,
  onRunChange,
  runFilterDisabled,
  showBackToBatch,
  onBackToBatch,
  showMassToggle,
  massUnit,
  onMassUnitChange,
  viewModes,
  activeView,
  defaultView,
  onViewChange,
}: TraceabilityHeaderProps) {
  return (
    <div className="container-max flex flex-wrap items-center gap-12 py-8">
      {/* The command bar replaced PageHeader, so this eyebrow carries the page's
          only heading. Styled as an eyebrow, still an h1 for the document
          outline and for screen-reader landmark navigation. */}
      <h1 className={EYEBROW_CLASS}>Traceability</h1>

      <BatchPicker
        batches={batches}
        selectedBatchId={selectedBatchId}
        isLoading={batchesLoading}
        isError={batchesError}
        error={batchesErrorDetail}
        onSelect={onSelectBatch}
      />

      {anchor === "batch" && showRunFilter ? (
        <div className="min-w-0 shrink-0" data-testid="chain-run-select">
          <RunPicker
            runs={runOptions}
            value={selectedRunId}
            onChange={onRunChange}
            disabled={runFilterDisabled}
          />
        </div>
      ) : null}

      {showBackToBatch ? (
        <Button
          variant="default"
          onClick={onBackToBatch}
          data-testid="chain-back-to-batch"
          className="border-[1.5px] border-[var(--clr-dark-purple-20)] px-[14px] text-[11px] text-[var(--clr-dark-purple-60)] hover:text-[var(--clr-dark-purple)]"
        >
          <ArrowLeftIcon size={14} weight="bold" />
          Batch roll-up
        </Button>
      ) : null}

      <div className="ml-auto flex flex-wrap items-center gap-8">
        {anchor !== "none" && showMassToggle ? (
          <SegmentSwitch
            label="Edge label unit"
            testId="chain-mass-toggle"
            options={MASS_UNIT_MODES}
            value={massUnit}
            onChange={onMassUnitChange}
          />
        ) : null}

        {anchor !== "none" ? (
          <SegmentSwitch
            label="View mode"
            testId="chain-view-segment"
            options={viewModes}
            value={activeView}
            onChange={(value) => onViewChange(value, defaultView)}
          />
        ) : null}

        {facility ? (
          <span
            title={facility.name}
            className={cn(
              FACILITY_MAX_WIDTH_CLASS,
              "truncate pl-4 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--clr-dark-purple-60)]"
            )}
          >
            {facility.name}
          </span>
        ) : (
          <span
            className={cn(
              FACILITY_MAX_WIDTH_CLASS,
              "truncate pl-4 body-caption text-[var(--color-text-tertiary)]"
            )}
          >
            No facility resolved
          </span>
        )}
      </div>
    </div>
  );
}
