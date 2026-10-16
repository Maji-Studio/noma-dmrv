"use client";

/** PROTOTYPE (throwaway): Variant A, "Work queue". Batches grouped by what they need, newest last in each lane. */
import { useState } from "react";
import { ArrowRightIcon, CaretDownIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Chip, CountBadge } from "../prototype-batch-page/prototype-parts";
import { BATCHES, matchesStage, STATE_META, STATE_ORDER, type BatchState, type StubBatch } from "./list-model";
import { BatchLink, MiniProgress, MUTED, PANEL, periodLabel, SampledMark, tons, useList } from "./list-parts";

/** Issued batches need nothing, so their lane starts closed. */
const START_OPEN: Record<BatchState, boolean> = { blocking: true, ready: true, submitted: true, issued: false };

const NEXT_ACTION: Record<BatchState, string | null> = {
  blocking: "Fix",
  ready: "Start Removal",
  submitted: null,
  issued: null,
};

function LaneRow({ batch }: { batch: StubBatch }) {
  const next = NEXT_ACTION[batch.state];
  return (
    <li className="border-t border-[var(--color-border-tertiary)] first:border-t-0">
      <BatchLink
        batch={batch}
        className="group -mx-12 grid min-h-44 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-16 gap-y-8 px-12 py-12 hover:bg-[var(--color-surface-medium)] md:grid-cols-[112px_minmax(0,1.4fr)_96px_minmax(0,1.6fr)_160px]"
      >
        <span className="col-start-1 row-start-1 body-medium font-medium tabular-nums md:col-start-auto md:row-start-auto">{batch.code}</span>
        <span className="col-start-1 flex min-w-0 flex-wrap items-center gap-8 md:col-start-auto">
          <Chip>{batch.feedstock}</Chip>
          <span className={cn("body-small", MUTED)}>{periodLabel(batch.month)}</span>
        </span>
        <span className="col-start-2 row-start-1 text-right body-medium tabular-nums md:col-start-auto md:row-start-auto">{tons(batch.applied)}</span>
        <span className="col-span-2 flex min-w-0 flex-col items-start gap-6 md:col-span-1">
          {/* The lane names the state; a row adds only what differs: the blocking count or its Removals. */}
          {batch.state === "blocking" ? (
            <CountBadge count={batch.blocking} blocking label={`${batch.blocking} blocking items`} />
          ) : batch.state !== "ready" ? (
            <span className={cn("body-small", MUTED)}>{batch.note}</span>
          ) : null}
          <span className="flex items-center gap-12">
            <span className="w-[120px]">
              <MiniProgress batch={batch} />
            </span>
            <SampledMark batch={batch} />
          </span>
        </span>
        <span className="hidden items-center gap-6 justify-self-end label-button group-hover:underline md:inline-flex">
          {next}
          {next && <ArrowRightIcon size={16} aria-hidden />}
        </span>
      </BatchLink>
    </li>
  );
}

function Lane({ state, batches }: { state: BatchState; batches: StubBatch[] }) {
  const [open, setOpen] = useState(START_OPEN[state]);
  const meta = STATE_META[state];
  const applied = batches.reduce((sum, batch) => sum + batch.applied, 0);
  return (
    <section aria-labelledby={`lane-${state}`} className={cn(PANEL, "flex flex-col gap-8 p-20 sm:p-24")}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="-mx-8 flex min-h-44 items-center justify-between gap-12 px-8 text-left hover:bg-[var(--color-surface-medium)]">
        <span className="flex min-w-0 flex-col gap-2">
          <span id={`lane-${state}`} className="inline-flex items-center gap-8 title-heading-3">
            <span className={cn("size-10 shrink-0 rounded-full", meta.dot)} aria-hidden />
            {meta.lane}
            <span className={cn("tabular-nums", MUTED)}>{batches.length}</span>
          </span>
          <span className={cn("body-small", MUTED)}>{meta.help}</span>
        </span>
        <span className="flex shrink-0 items-center gap-12">
          <span className="hidden body-small tabular-nums sm:inline">{tons(applied)} applied</span>
          <CaretDownIcon size={20} className={cn("transition-transform", open && "rotate-180")} aria-hidden />
        </span>
      </button>
      {open && (
        <ul className="flex flex-col">
          {batches.map((batch) => (
            <LaneRow key={batch.code} batch={batch} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function LanesVariant() {
  const { stage } = useList();
  const visible = BATCHES.filter((batch) => matchesStage(batch, stage));
  return (
    <div className="flex flex-col gap-24">
      {STATE_ORDER.map((state) => {
        const batches = visible.filter((batch) => batch.state === state);
        return batches.length > 0 ? <Lane key={state} state={state} batches={batches} /> : null;
      })}
    </div>
  );
}
