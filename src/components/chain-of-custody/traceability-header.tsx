"use client";

import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BatchPicker } from "./batch-picker";
import { RunPicker, type RunPickerOption } from "./run-picker";

const CONTROL_HEIGHT_CLASS = "h-40";
const FACILITY_MAX_WIDTH_CLASS = "max-w-[180px]";

const EYEBROW_CLASS =
  "shrink-0 font-mono text-[10px] font-medium uppercase tracking-[0.14em] " +
  "text-[var(--clr-dark-purple-40)]";

const SEGMENT_GROUP_CLASS =
  "flex items-stretch border-[1.5px] border-[var(--clr-dark-purple-20)]";
const SEGMENT_BUTTON_CLASS =
  "flex cursor-pointer items-center border-r-[1.5px] border-[var(--clr-dark-purple-20)] " +
  "px-12 font-mono text-[11px] font-medium uppercase tracking-[0.06em] last:border-r-0";
const SEGMENT_ACTIVE_CLASS =
  "bg-[var(--clr-dark-purple)] text-[var(--color-background-white)]";
const SEGMENT_IDLE_CLASS =
  "text-[var(--clr-dark-purple-60)] hover:text-[var(--clr-dark-purple)]";

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
      <span className={EYEBROW_CLASS}>Traceability</span>

      <BatchPicker
        batches={batches}
        selectedBatchId={selectedBatchId}
        isLoading={batchesLoading}
        isError={batchesError}
        error={batchesErrorDetail}
        onSelect={onSelectBatch}
      />

      {anchor === "batch" ? (
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
          className="border-[1.5px] border-[var(--clr-dark-purple-20)] px-[14px] text-[11px] tracking-[0.06em] text-[var(--clr-dark-purple-60)] hover:text-[var(--clr-dark-purple)]"
        >
          <ArrowLeftIcon size={14} weight="bold" />
          Batch roll-up
        </Button>
      ) : null}

      <div className="ml-auto flex flex-wrap items-center gap-8">
        {anchor !== "none" && showMassToggle ? (
          <div
            className={cn(SEGMENT_GROUP_CLASS, CONTROL_HEIGHT_CLASS)}
            role="group"
            aria-label="Edge label unit"
            data-testid="chain-mass-toggle"
          >
            {MASS_UNIT_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                aria-pressed={massUnit === mode.value}
                onClick={() => onMassUnitChange(mode.value)}
                title={mode.title}
                className={cn(
                  SEGMENT_BUTTON_CLASS,
                  massUnit === mode.value
                    ? SEGMENT_ACTIVE_CLASS
                    : SEGMENT_IDLE_CLASS
                )}
              >
                {mode.label}
              </button>
            ))}
          </div>
        ) : null}

        {anchor !== "none" ? (
          <div
            className={cn(SEGMENT_GROUP_CLASS, CONTROL_HEIGHT_CLASS)}
            role="group"
            aria-label="View mode"
            data-testid="chain-view-segment"
          >
            {viewModes.map((mode) => (
              <button
                key={mode.value}
                type="button"
                aria-pressed={activeView === mode.value}
                onClick={() => onViewChange(mode.value, defaultView)}
                className={cn(
                  SEGMENT_BUTTON_CLASS,
                  activeView === mode.value
                    ? SEGMENT_ACTIVE_CLASS
                    : SEGMENT_IDLE_CLASS
                )}
              >
                {mode.label}
              </button>
            ))}
          </div>
        ) : null}

        {facility ? (
          <span
            title={`${facility.code} - ${facility.name}`}
            className={cn(
              FACILITY_MAX_WIDTH_CLASS,
              "truncate pl-4 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--clr-dark-purple-60)]"
            )}
          >
            {facility.code}
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
