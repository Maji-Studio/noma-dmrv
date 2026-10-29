"use client";

/**
 * One chain of the batch, end to end, like the buyer journey's hero chain: one
 * step per stage from the supplier to the chain's end. A stage with one record
 * is a plain step; a stage where several records converge (intakes, runs,
 * products) is one step that lists them, each opening in place. Back / Next
 * step stage to stage (the map follows), and "Whole batch" returns to the
 * stage list.
 */

import { ArrowLeftIcon, CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChainStep, TraceChain } from "./trace-chains";
import type { TraceModel, TraceRecord } from "./trace-model";
import { RecordValues, recordSummary } from "./trace-record-values";
import { ROW_FOCUS_CLASS, ScrollTarget, TILE_TEXT_INSET_PX, TraceThread, TraceTile } from "./trace-tile";

const pad = (value: number) => String(value).padStart(2, "0");

export function TraceChainWalk({
  model,
  chain,
  steps,
  stepIndex,
  openRecordId,
  onStep,
  onOpenRecord,
  onLeave,
  onTrace,
}: {
  model: TraceModel;
  chain: TraceChain;
  steps: ChainStep[];
  stepIndex: number;
  /** The record opened in place inside a grouped step; null = none. */
  openRecordId: string | null;
  onStep: (index: number) => void;
  onOpenRecord: (recordId: string | null) => void;
  onLeave: () => void;
  onTrace: (recordId: string) => void;
}) {
  const last = steps.length - 1;
  const current = steps[stepIndex];
  if (!current) return null;
  const values = (record: TraceRecord, inset: number) => (
    <RecordValues model={model} record={record} onTrace={onTrace} className="pb-16" style={{ marginLeft: inset }} />
  );
  return (
    <>
      <div className="flex shrink-0 flex-col gap-8 border-b border-[var(--clr-dark-purple-10)] px-16 py-10">
        <div className="flex items-center justify-between gap-12">
          <Button variant="noOutline" size="small" className="-ml-12 min-h-44 md:min-h-0" onClick={onLeave}>
            <ArrowLeftIcon size={12} weight="bold" />
            Whole batch
          </Button>
          <div className="flex shrink-0 gap-8">
            {stepIndex > 0 ? (
              <Button variant="weak" size="small" className="min-h-44 md:min-h-0" onClick={() => onStep(stepIndex - 1)}>
                <CaretLeftIcon size={12} weight="bold" />
                Back
              </Button>
            ) : null}
            {stepIndex < last ? (
              <Button variant="weak" size="small" className="min-h-44 md:min-h-0" onClick={() => onStep(stepIndex + 1)}>
                Next
                <CaretRightIcon size={12} weight="bold" />
              </Button>
            ) : null}
          </div>
        </div>
        <p className="body-caption font-mono uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
          {pad(stepIndex + 1)} / {pad(steps.length)} · To {chain.end.shortCode}
        </p>
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto px-16 py-12">
        {steps.map((step, index) => {
          const isCurrent = index === stepIndex;
          const first = step.records[0]!;
          const grouped = step.records.length > 1;
          return (
            <li key={step.kind} className="relative pb-4">
              {index < last ? <TraceThread dark={index < stepIndex} /> : null}
              {/* The list scrolls to the opened member of a grouped step, else to the step. */}
              {isCurrent && !(grouped && openRecordId !== null && step.records.some((record) => record.id === openRecordId)) ? <ScrollTarget /> : null}
              <button
                type="button"
                onClick={() => onStep(index)}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "flex min-h-44 w-full items-start gap-12 py-8 text-left",
                  ROW_FOCUS_CLASS,
                  !isCurrent && "opacity-70 hover:opacity-100",
                )}
              >
                <TraceTile icon={first.icon} accent={first.accent} accentInk={first.accentInk} ghost={index > stepIndex} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="body-caption truncate" style={{ color: first.accentInk }}>
                    {step.title}
                    {!grouped && first.date ? <span className="text-[var(--color-text-tertiary)]"> · {first.date}</span> : null}
                  </span>
                  {grouped ? (
                    isCurrent ? null : (
                      <span className="truncate font-mono text-[13px] font-medium text-[var(--color-text-primary)]">
                        {step.records.map((record) => record.shortCode).join(", ")}
                      </span>
                    )
                  ) : (
                    <span className="flex min-w-0 items-baseline gap-8">
                      <span className="shrink-0 font-mono text-[14px] font-medium text-[var(--color-text-primary)]">{first.shortCode}</span>
                      {isCurrent ? null : (
                        <span className="body-caption truncate text-[var(--color-text-tertiary)]">{recordSummary(model, first)}</span>
                      )}
                    </span>
                  )}
                </span>
              </button>
              {isCurrent && !grouped ? values(first, TILE_TEXT_INSET_PX) : null}
              {isCurrent && grouped ? (
                <ul className="mb-8 flex flex-col" style={{ marginLeft: TILE_TEXT_INSET_PX }}>
                  {step.records.map((record) => {
                    const open = record.id === openRecordId;
                    return (
                      <li key={record.id} className="relative border-b border-[var(--clr-dark-purple-10)] last:border-b-0">
                        {open ? <ScrollTarget /> : null}
                        <button
                          type="button"
                          onClick={() => onOpenRecord(open ? null : record.id)}
                          aria-expanded={open}
                          className={cn(
                            "flex min-h-44 w-full items-baseline justify-between gap-12 py-8 text-left hover:bg-[var(--clr-dark-purple-1)]",
                            ROW_FOCUS_CLASS,
                            open && "bg-[var(--clr-dark-purple-1)]",
                          )}
                        >
                          <span className="font-mono text-[13px] font-medium text-[var(--color-text-primary)]">{record.shortCode}</span>
                          <span className="body-caption min-w-0 truncate text-right text-[var(--color-text-tertiary)]">
                            {open ? (record.date ?? "") : recordSummary(model, record)}
                          </span>
                        </button>
                        {open ? values(record, 0) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}
