"use client";

/** PROTOTYPE (throwaway): Variant C, "Cards". The card hub, speaking the batch page's language. Newest first. */
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Chip } from "../prototype-batch-page/prototype-parts";
import { BATCHES, matchesStage, type StubBatch } from "./list-model";
import { BatchLink, MiniProgress, MUTED, periodLabel, SampledMark, StateNote, tons, useList } from "./list-parts";

const NEXT_ACTION: Record<StubBatch["state"], string | null> = {
  blocking: "Fix next item",
  ready: "Start Removal",
  submitted: null,
  issued: null,
};

/** Where the applied tonnes sit, in one line. */
function massLine(batch: StubBatch): string {
  if (batch.state === "issued") return `${tons(batch.issued)} issued`;
  if (batch.submitted > 0) {
    const rest = batch.applied - batch.submitted;
    return rest > 0.005 ? `${tons(batch.submitted)} submitted, ${tons(rest)} not in a Removal` : `${tons(batch.submitted)} submitted`;
  }
  return "Not in a Removal";
}

function Card({ batch }: { batch: StubBatch }) {
  const next = NEXT_ACTION[batch.state];
  return (
    <BatchLink batch={batch} className="group flex flex-col border border-[var(--color-border-secondary)] bg-[var(--paper)] hover:border-[var(--ink)]">
      <div className="flex flex-1 flex-col gap-16 p-20">
        <div className="flex items-start justify-between gap-12">
          <span className="flex flex-col gap-6">
            <span className="title-heading-3 tabular-nums">{batch.code}</span>
            <span className="flex flex-wrap items-center gap-8">
              <Chip>{batch.feedstock}</Chip>
              <span className={cn("body-small", MUTED)}>{periodLabel(batch.month)}</span>
            </span>
          </span>
          <SampledMark batch={batch} />
        </div>
        <MiniProgress batch={batch} />
        <dl className="grid grid-cols-2 gap-12">
          <div className="flex flex-col gap-2">
            <dt className={cn("body-small", MUTED)}>Applied biochar</dt>
            <dd className="body-large tabular-nums">{tons(batch.applied)}</dd>
          </div>
          <div className="flex flex-col gap-2">
            <dt className={cn("body-small", MUTED)}>Where it is</dt>
            <dd className="body-small">{massLine(batch)}</dd>
          </div>
        </dl>
      </div>
      <div className="flex min-h-44 items-center justify-between gap-12 border-t border-[var(--color-border-tertiary)] px-20 py-10">
        <StateNote batch={batch} />
        {next && (
          <span className="inline-flex shrink-0 items-center gap-6 label-button group-hover:underline">
            {next}
            <ArrowRightIcon size={16} aria-hidden />
          </span>
        )}
      </div>
    </BatchLink>
  );
}

export function CardsVariant() {
  const { stage } = useList();
  const visible = [...BATCHES].reverse().filter((batch) => matchesStage(batch, stage));
  return (
    <div className="grid grid-cols-1 gap-24 md:grid-cols-2 xl:grid-cols-3">
      {visible.map((batch) => (
        <Card key={batch.code} batch={batch} />
      ))}
    </div>
  );
}
