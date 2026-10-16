"use client";

/** PROTOTYPE (throwaway): Variant A, "Board". One column per state, oldest work first. */
import { useState } from "react";
import { ArrowRightIcon, FlaskIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Chip, CountBadge } from "../prototype-batch-page/prototype-parts";
import { BATCHES, matchesStage, STATE_META, STATE_ORDER, type BatchState, type StubBatch } from "./list-model";
import { BatchLink, MUTED, periodLabel, tons, useList } from "./list-parts";

/** Issued needs nothing, so it shows the latest few and folds the rest. */
const ISSUED_SHOWN = 3;

const NEXT_ACTION: Record<BatchState, string | null> = {
  blocking: "Fix next item",
  ready: "Start Removal",
  submitted: null,
  issued: null,
};

function BoardCard({ batch }: { batch: StubBatch }) {
  const next = NEXT_ACTION[batch.state];
  return (
    <li>
      <BatchLink batch={batch} className="group flex flex-col gap-10 border border-[var(--color-border-secondary)] bg-[var(--paper)] p-12 hover:border-[var(--ink)]">
        <span className="flex items-center justify-between gap-8">
          <span className="body-medium font-medium tabular-nums">{batch.code}</span>
          <span className="inline-flex items-center gap-8">
            {batch.sampled && (
              <span className={MUTED}>
                <FlaskIcon size={16} aria-hidden />
                <span className="sr-only">Sampled</span>
              </span>
            )}
            {batch.state === "blocking" && <CountBadge count={batch.blocking} blocking label={`${batch.blocking} blocking items`} />}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <Chip>{batch.feedstock}</Chip>
        </span>
        <span className={cn("body-caption", MUTED)}>{periodLabel(batch)}</span>
        <span className="flex items-baseline justify-between gap-8">
          <span className="body-medium tabular-nums">{tons(batch.applied)}</span>
          {batch.removals.length > 0 && <span className={cn("body-caption", MUTED)}>{batch.removals.join(", ")}</span>}
        </span>
        {next && (
          <span className="inline-flex items-center gap-6 border-t border-[var(--color-border-tertiary)] pt-10 label-button group-hover:underline">
            {next}
            <ArrowRightIcon size={16} aria-hidden />
          </span>
        )}
      </BatchLink>
    </li>
  );
}

function Column({ state, batches }: { state: BatchState; batches: StubBatch[] }) {
  const [showAll, setShowAll] = useState(false);
  const meta = STATE_META[state];
  const folded = state === "issued" && !showAll && batches.length > ISSUED_SHOWN;
  const shown = folded ? batches.slice(0, ISSUED_SHOWN) : batches;
  const applied = batches.reduce((sum, batch) => sum + batch.applied, 0);
  return (
    <section aria-labelledby={`col-${state}`} className="flex w-[280px] shrink-0 snap-start flex-col gap-12 bg-[var(--color-surface-light)] p-12 lg:w-auto">
      <header className="flex flex-col gap-4 px-4">
        <span className={cn("h-4 w-full", meta.bar)} aria-hidden />
        <h2 id={`col-${state}`} className="inline-flex items-baseline gap-8 pt-6 body-medium font-medium">
          {meta.lane}
          <span className={cn("tabular-nums", MUTED)}>{batches.length}</span>
        </h2>
        <span className={cn("body-caption", MUTED)}>{batches.length > 0 ? `${tons(applied)} applied` : meta.help}</span>
      </header>
      {shown.length > 0 && (
        <ul className="flex flex-col gap-8">
          {shown.map((batch) => (
            <BoardCard key={batch.code} batch={batch} />
          ))}
        </ul>
      )}
      {folded && (
        <button type="button" onClick={() => setShowAll(true)} className="min-h-44 border border-dashed border-[var(--color-border-secondary)] body-small hover:bg-[var(--paper)]">
          Show {batches.length - ISSUED_SHOWN} more
        </button>
      )}
    </section>
  );
}

export function KanbanVariant() {
  const { stage } = useList();
  const visible = BATCHES.filter((batch) => matchesStage(batch, stage));
  return (
    // Phones swipe between columns; the scroll box is relative so sr-only text stays inside it.
    <div className="relative -mx-20 flex snap-x gap-12 overflow-x-auto px-20 pb-4 sm:mx-0 sm:px-0 lg:grid lg:grid-cols-4 lg:gap-16 lg:overflow-visible">
      {STATE_ORDER.map((state) => {
        const batches = visible.filter((batch) => batch.state === state);
        // Work columns: oldest first (it has waited longest). Issued: newest first.
        const ordered = state === "issued" ? [...batches].reverse() : batches;
        return <Column key={state} state={state} batches={ordered} />;
      })}
    </div>
  );
}
