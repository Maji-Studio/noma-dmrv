"use client";

/**
 * The Traceability Map at rest: the batch's stages as a vertical timeline with
 * an icon and a count each. A stage opens in place with its records one line
 * each (the map frames that stage and lights its legs); picking a record starts
 * its chain walk. Back / Next step from stage to stage.
 */

import { CaretDownIcon, CaretLeftIcon, CaretRightIcon, ListChecksIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui";
import { cn } from "@/lib/utils";
import { recordSummary } from "./trace-record-values";
import { ScrollTarget, TILE_TEXT_INSET_PX, TraceThread, TraceTile } from "./trace-tile";
import type { TraceModel, TraceStage } from "./trace-model";

/** "2 feedstocks · 2 places": what a stage holds and where the map shows it. */
function stageSummary(stage: TraceStage): string {
  const count = `${stage.records.length} ${stage.records.length === 1 ? stage.title.toLowerCase() : stage.plural}`;
  const onMap = stage.records.filter((record) => record.position).length;
  if (onMap === 0) return `${count} · at the facility`;
  const places = new Set(stage.records.flatMap((record) => (record.sub ? [record.sub] : []))).size;
  return places > 0 ? `${count} · ${places} ${places === 1 ? "place" : "places"}` : count;
}

export function TraceStageList({
  model,
  stageIndex,
  onSelectStage,
  onPickRecord,
}: {
  model: TraceModel;
  stageIndex: number | null;
  onSelectStage: (index: number | null) => void;
  onPickRecord: (recordId: string) => void;
}) {
  const last = model.stages.length - 1;
  const stage = stageIndex === null ? null : model.stages[stageIndex] ?? null;
  if (model.stages.length === 0) {
    return (
      <EmptyState
        icon={<ListChecksIcon size={32} weight="thin" />}
        title="No records in this batch yet"
        description="Stages appear here once the batch has production runs, deliveries or applications."
        padding="sm"
      />
    );
  }
  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-12 border-b border-[var(--clr-dark-purple-10)] px-16 py-10">
        <p className="body-caption min-w-0 truncate font-mono uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
          {stage
            ? `${String((stageIndex ?? 0) + 1).padStart(2, "0")} / ${String(model.stages.length).padStart(2, "0")} · ${stage.title}`
            : `${model.stages.length} stages`}
        </p>
        <div className="flex shrink-0 gap-8">
          <Button
            variant="weak"
            size="small"
            className="min-h-44 md:min-h-0"
            onClick={() => onSelectStage(stageIndex === null || stageIndex === 0 ? null : stageIndex - 1)}
            aria-disabled={stageIndex === null}
          >
            <CaretLeftIcon size={12} weight="bold" />
            Back
          </Button>
          <Button
            variant="weak"
            size="small"
            className="min-h-44 md:min-h-0"
            onClick={() => onSelectStage(stageIndex === null ? 0 : Math.min(last, stageIndex + 1))}
            aria-disabled={stageIndex === last}
          >
            Next
            <CaretRightIcon size={12} weight="bold" />
          </Button>
        </div>
      </div>

      <ol className="min-h-0 flex-1 overflow-y-auto px-16 py-12">
        {model.stages.map((candidate, index) => {
          const open = index === stageIndex;
          return (
            <li key={candidate.kind} className="relative pb-4">
              {index < last ? <TraceThread /> : null}
              {open ? <ScrollTarget /> : null}
              <button
                type="button"
                onClick={() => onSelectStage(open ? null : index)}
                aria-expanded={open}
                className={cn(
                  "flex min-h-44 w-full items-center gap-12 py-8 text-left",
                  stageIndex !== null && !open && "opacity-60 hover:opacity-100",
                )}
              >
                <TraceTile
                  icon={candidate.icon}
                  accent={candidate.accent}
                  accentInk={candidate.accentInk}
                  ghost={!open && stageIndex !== null}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="body-small font-medium text-[var(--color-text-primary)]">{candidate.title}</span>
                  <span className="body-caption truncate text-[var(--color-text-tertiary)]">{stageSummary(candidate)}</span>
                </span>
                <CaretDownIcon
                  size={14}
                  className={cn("shrink-0 text-[var(--color-text-tertiary)] transition-transform", open && "rotate-180")}
                />
              </button>
              {open ? (
                <ul className="mb-8 flex flex-col" style={{ marginLeft: TILE_TEXT_INSET_PX }}>
                  {candidate.records.map((record) => (
                    <li key={record.id} className="border-b border-[var(--clr-dark-purple-10)] last:border-b-0">
                      <button
                        type="button"
                        onClick={() => onPickRecord(record.id)}
                        className="flex min-h-44 w-full items-center justify-between gap-12 py-8 text-left hover:bg-[var(--clr-dark-purple-1)]"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="font-mono text-[13px] font-medium text-[var(--color-text-primary)]">{record.shortCode}</span>
                          <span className="body-caption truncate text-[var(--color-text-tertiary)]">{recordSummary(model, record)}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-8">
                          {record.date ? (
                            <span className="body-caption text-[var(--color-text-tertiary)]">{record.date}</span>
                          ) : null}
                          <CaretRightIcon size={14} className="text-[var(--color-text-tertiary)]" />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}
