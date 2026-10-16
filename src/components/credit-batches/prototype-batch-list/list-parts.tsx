"use client";

/** PROTOTYPE (throwaway): pieces shared by the credit batch overview variants. */
import Link from "next/link";
import { createContext, useContext, type ReactNode } from "react";
import { formatDateRange, formatTonnes } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { CountBadge } from "../prototype-batch-page/prototype-parts";
import { BATCHES, matchesStage, pipeline, SCENARIO_FOR, type PipelineStage, type StubBatch } from "./list-model";

export const MUTED = "text-[var(--color-text-secondary)]";
export const PANEL = "border border-[var(--color-border-secondary)] bg-[var(--paper)]";

interface ListContextValue {
  /** The real batch the batch page prototype renders, whatever stub was clicked. */
  realBatchId: string | null;
  stage: PipelineStage["key"] | null;
  setStage: (stage: PipelineStage["key"] | null) => void;
}

const ListContext = createContext<ListContextValue | null>(null);

export function ListProvider({ value, children }: { value: ListContextValue; children: ReactNode }) {
  return <ListContext.Provider value={value}>{children}</ListContext.Provider>;
}

export function useList(): ListContextValue {
  const value = useContext(ListContext);
  if (!value) throw new Error("useList needs a ListProvider");
  return value;
}

export function batchHref(realBatchId: string | null, batch: StubBatch): string {
  return realBatchId ? `/credit-batches/${realBatchId}?scenario=${SCENARIO_FOR[batch.state]}` : "#";
}

export function useVisible(batch: StubBatch): boolean {
  const { stage } = useList();
  return matchesStage(batch, stage);
}

/** The batch window as the shared range formatter prints it ("Sep 1 to Sep 30, 2026"). */
export function periodLabel(batch: StubBatch): string {
  return formatDateRange(batch.start, batch.end);
}

export function tons(value: number): string {
  return formatTonnes(value);
}

/** Milestones reached per state: Data complete, Removal submitted, Verified, Credits issued. */
const DONE_STEPS: Record<StubBatch["state"], number> = { blocking: 0, ready: 1, submitted: 2, issued: 4 };

/** Four milestone bars, the batch page's progress at card size. */
export function MiniProgress({ batch }: { batch: StubBatch }) {
  const done = DONE_STEPS[batch.state];
  return (
    <span className="grid grid-cols-4 gap-2" aria-hidden>
      {[0, 1, 2, 3].map((index) => (
        <span
          key={index}
          className={cn(
            "h-4",
            index < done && "bg-[var(--st-ok)]",
            index === done && (batch.state === "blocking" ? "bg-[var(--st-bad)]" : "bg-[var(--ink)]"),
            index > done && "bg-[var(--color-border-tertiary)]",
          )}
        />
      ))}
    </span>
  );
}

/** The state line for a batch: a dot or red count, then what is next. */
export function StateNote({ batch }: { batch: StubBatch }) {
  if (batch.state === "blocking") {
    return (
      <span className="inline-flex items-center gap-8 body-small">
        <CountBadge count={batch.blocking} blocking label={`${batch.blocking} blocking items`} />
        Needs work
      </span>
    );
  }
  return <span className={cn("body-small", batch.state === "ready" ? "font-medium" : MUTED)}>{batch.note}</span>;
}

/**
 * The tonnes from production to issued credits. Each stage is a filter: it keeps
 * the batches that hold mass in the gap before it.
 */
export function MassPipeline() {
  const { stage, setStage } = useList();
  const stages = pipeline();
  return (
    <div className={cn(PANEL, "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5")} role="group" aria-label="Biochar from production to issued credits">
      {stages.map((item, index) => {
        const active = stage === item.key;
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={active}
            onClick={() => setStage(active ? null : item.key)}
            className={cn(
              "flex min-h-44 flex-col items-start gap-4 border-[var(--color-border-tertiary)] p-16 text-left hover:bg-[var(--color-surface-medium)] lg:p-20",
              index > 0 && "border-l",
              index >= 2 && "border-t sm:border-t-0",
              index === 2 && "border-l-0 sm:border-l",
              index >= 3 && "sm:border-t lg:border-t-0",
              index === 3 && "sm:border-l-0 lg:border-l",
              active && "bg-[var(--color-surface-medium)] outline outline-2 -outline-offset-2 outline-[var(--ink)]",
            )}
          >
            <span className={cn("body-small", MUTED)}>{item.label}</span>
            <span className="title-heading-3 tabular-nums">{tons(item.tons)}</span>
            <span className={cn("body-caption", MUTED)}>{item.gap ? (item.gap.tons > 0.005 ? `${tons(item.gap.tons)} ${item.gap.label}` : `No biochar ${item.gap.label}`) : `${BATCHES.length} credit batches`}</span>
          </button>
        );
      })}
    </div>
  );
}

export function StageFilterNote() {
  const { stage, setStage } = useList();
  if (!stage || stage === "produced") return null;
  const item = pipeline().find((s) => s.key === stage);
  return (
    <p className="flex flex-wrap items-center gap-8 body-small">
      Showing credit batches with biochar {item?.gap?.label}.
      <button type="button" className="font-medium underline underline-offset-2" onClick={() => setStage(null)}>
        Show all
      </button>
    </p>
  );
}

export function BatchLink({ batch, className, title, children }: { batch: StubBatch; className?: string; title?: string; children: ReactNode }) {
  const { realBatchId } = useList();
  return (
    <Link href={batchHref(realBatchId, batch)} className={className} title={title}>
      {children}
    </Link>
  );
}
