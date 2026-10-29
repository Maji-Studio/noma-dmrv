"use client";

/**
 * One chain of the batch, end to end, like the buyer journey's hero chain:
 * every record from the supplier to the chain's end, the current one open in
 * place with its values. Back / Next step record by record (the map follows),
 * and "Whole batch" returns to the stage list.
 */

import { ArrowLeftIcon, CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { formatDistanceKm } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import type { TraceChain } from "./trace-chains";
import type { TraceModel } from "./trace-model";
import { RecordValues, recordSummary } from "./trace-record-values";
import { ScrollTarget, TILE_TEXT_INSET_PX, TraceThread, TraceTile } from "./trace-tile";

const pad = (value: number) => String(value).padStart(2, "0");

export function TraceChainWalk({
  model,
  chain,
  stepIndex,
  onStep,
  onLeave,
  onTrace,
}: {
  model: TraceModel;
  chain: TraceChain;
  stepIndex: number;
  onStep: (index: number) => void;
  onLeave: () => void;
  onTrace: (recordId: string) => void;
}) {
  const last = chain.steps.length - 1;
  const current = chain.steps[stepIndex];
  if (!current) return null;
  return (
    <>
      <div className="flex shrink-0 flex-col gap-8 border-b border-[var(--clr-dark-purple-10)] px-16 py-10">
        <div className="flex items-center justify-between gap-12">
          <Button variant="noOutline" size="small" className="-ml-12 min-h-44 md:min-h-0" onClick={onLeave}>
            <ArrowLeftIcon size={12} weight="bold" />
            Whole batch
          </Button>
          <div className="flex shrink-0 gap-8">
            <Button
              variant="weak"
              size="small"
              className="min-h-44 md:min-h-0"
              aria-disabled={stepIndex === 0}
              onClick={() => onStep(Math.max(0, stepIndex - 1))}
            >
              <CaretLeftIcon size={12} weight="bold" />
              Back
            </Button>
            <Button
              variant="weak"
              size="small"
              className="min-h-44 md:min-h-0"
              aria-disabled={stepIndex >= last}
              onClick={() => onStep(Math.min(last, stepIndex + 1))}
            >
              Next
              <CaretRightIcon size={12} weight="bold" />
            </Button>
          </div>
        </div>
        <p className="body-caption font-mono uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
          {pad(stepIndex + 1)} / {pad(chain.steps.length)} · to {chain.end.shortCode}
          {chain.distanceKm > 0 ? ` · ${formatDistanceKm(chain.distanceKm)} one way` : ""}
        </p>
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto px-16 py-12">
        {chain.steps.map((record, index) => {
          const isCurrent = record.id === current.id;
          return (
            <li key={record.id} className="relative pb-4">
              {index < last ? <TraceThread dark={index < stepIndex} /> : null}
              {isCurrent ? <ScrollTarget /> : null}
              <button
                type="button"
                onClick={() => onStep(index)}
                aria-current={isCurrent ? "step" : undefined}
                className={cn("flex min-h-44 w-full items-start gap-12 py-8 text-left", !isCurrent && "opacity-70 hover:opacity-100")}
              >
                <TraceTile icon={record.icon} accent={record.accent} accentInk={record.accentInk} ghost={index > stepIndex} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="body-caption truncate" style={{ color: record.accentInk }}>
                    {record.label}
                    {record.date ? <span className="text-[var(--color-text-tertiary)]"> · {record.date}</span> : null}
                  </span>
                  <span className="flex min-w-0 items-baseline gap-8">
                    <span className="shrink-0 font-mono text-[14px] font-medium text-[var(--color-text-primary)]">{record.shortCode}</span>
                    <span className="body-caption truncate text-[var(--color-text-tertiary)]">{recordSummary(model, record)}</span>
                  </span>
                </span>
              </button>
              {isCurrent ? (
                <RecordValues
                  model={model}
                  record={record}
                  onTrace={onTrace}
                  className="pb-16"
                  style={{ marginLeft: TILE_TEXT_INSET_PX }}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}
