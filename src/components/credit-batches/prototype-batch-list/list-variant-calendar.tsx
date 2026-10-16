"use client";

/** PROTOTYPE (throwaway): Variant B, "Production calendar". Feedstocks by month, one tile per credit batch. */
import { FlaskIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { CountBadge } from "../prototype-batch-page/prototype-parts";
import { BATCHES, FEEDSTOCKS, METHOD_B_EVERY, MONTH_LABELS, MONTHS, STATE_META, STATE_ORDER, type StubBatch } from "./list-model";
import { BatchLink, MUTED, PANEL, tons, useVisible } from "./list-parts";

function Tile({ batch }: { batch: StubBatch }) {
  const visible = useVisible(batch);
  const meta = STATE_META[batch.state];
  return (
    <BatchLink
      batch={batch}
      className={cn(
        "flex min-h-[112px] flex-col gap-6 border border-[var(--color-border-secondary)] bg-[var(--paper)] hover:border-[var(--ink)]",
        !visible && "opacity-40",
      )}
    >
      <span className={cn("h-4", meta.bar)} aria-hidden />
      <span className="flex flex-col gap-4 px-10 pb-10">
        <span className="whitespace-nowrap body-small font-medium tabular-nums">{batch.code}</span>
        <span className="body-medium tabular-nums">{tons(batch.applied)}</span>
        <span className="flex items-center justify-between gap-6 body-caption">
          <span className="inline-flex items-center gap-6">
            {batch.state === "blocking" ? <CountBadge count={batch.blocking} blocking label={`${batch.blocking} blocking items`} /> : null}
            <span className={batch.state === "blocking" || batch.state === "ready" ? "font-medium" : MUTED}>{meta.title}</span>
          </span>
          {batch.sampled && (
            <span className="shrink-0">
              <FlaskIcon size={14} aria-hidden />
              <span className="sr-only">Sampled</span>
            </span>
          )}
        </span>
      </span>
    </BatchLink>
  );
}

function EmptyCell() {
  return (
    <div className={cn("flex min-h-[112px] items-center justify-center border border-dashed border-[var(--color-border-secondary)] px-8 text-center body-caption", MUTED)}>
      No batch
    </div>
  );
}

function Legend() {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-20 gap-y-8 body-caption", MUTED)}>
      {STATE_ORDER.map((state) => (
        <li key={state} className="inline-flex items-center gap-6">
          <span className={cn("h-4 w-16", STATE_META[state].bar)} aria-hidden />
          {STATE_META[state].title}
        </li>
      ))}
      <li className="inline-flex items-center gap-6">
        <FlaskIcon size={14} aria-hidden />
        Sampled
      </li>
    </ul>
  );
}

function SamplingNote() {
  return (
    <ul className="flex flex-col gap-4 body-small">
      {FEEDSTOCKS.map((feedstock) => {
        const batches = BATCHES.filter((batch) => batch.feedstock === feedstock);
        const sinceSampled = [...batches].reverse().findIndex((batch) => batch.sampled);
        const left = METHOD_B_EVERY - (sinceSampled < 0 ? batches.length : sinceSampled);
        return (
          <li key={feedstock}>
            <span className="font-medium">{feedstock}:</span>{" "}
            <span className={MUTED}>
              {batches.filter((batch) => batch.sampled).length} of {batches.length} batches sampled. Method B needs the next sampled batch within {left} {left === 1 ? "batch" : "batches"}.
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function CalendarVariant() {
  const columns = `minmax(120px,160px) repeat(${MONTHS.length}, minmax(112px,1fr))`;
  return (
    <section className={cn(PANEL, "flex min-w-0 flex-col gap-20 p-20 sm:p-24")} aria-label="Credit batches by feedstock and month">
      <div className="flex flex-wrap items-end justify-between gap-12">
        <h2 className="title-heading-3">Production, Mar to Sep 2026</h2>
        <Legend />
      </div>
      {/* Wide grid: it scrolls inside the panel on narrow screens, never the page. `relative` keeps the sr-only labels inside the scroll box. */}
      <div className="relative -mx-20 overflow-x-auto px-20 sm:mx-0 sm:px-0">
        <div className="grid min-w-[960px] gap-8" style={{ gridTemplateColumns: columns }} role="table">
          <div role="row" className="contents">
            <span role="columnheader">
              <span className="sr-only">Feedstock</span>
            </span>
            {MONTHS.map((month) => (
              <span key={month} role="columnheader" className={cn("body-small font-medium", MUTED)}>
                {MONTH_LABELS[month]}
              </span>
            ))}
          </div>
          {FEEDSTOCKS.map((feedstock) => {
            const rows = BATCHES.filter((batch) => batch.feedstock === feedstock);
            const applied = rows.reduce((sum, batch) => sum + batch.applied, 0);
            return (
              <div key={feedstock} role="row" className="contents">
                <span role="rowheader" className="flex flex-col justify-center gap-2 pr-8">
                  <span className="body-medium font-medium">{feedstock}</span>
                  <span className={cn("body-caption tabular-nums", MUTED)}>{tons(applied)} applied</span>
                </span>
                {MONTHS.map((month) => {
                  const batch = rows.find((row) => row.month === month);
                  return (
                    <div key={month} role="cell">
                      {batch ? <Tile batch={batch} /> : <EmptyCell />}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div className="border-t border-[var(--color-border-tertiary)] pt-16">
        <SamplingNote />
      </div>
    </section>
  );
}
