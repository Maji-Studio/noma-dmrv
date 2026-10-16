/**
 * PROTOTYPE variant B, "Rail and tasks". Credit batches stay in a left rail
 * on both routes, so picking one never rebuilds the page around it: the
 * right pane is the real sub-route. The pane is a task list of open lines,
 * each with its actions in view; done lines wait behind "Show N done lines".
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleIcon, CheckCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { PROTOTYPE_TEMPLATE_NAME, entryText, type PrototypeLine } from "./prototype-emissions-data";
import {
  ActivityTotals,
  DisclosureButton,
  EmissionsBreadcrumb,
  EntrySheet,
  LineDetails,
  LineStateBadge,
  NeedsSetupText,
  ReviewBlock,
  batchPeriod,
  creditBatchSheetHref,
  openCountText,
  useEmissionsHref,
  useEntrySheet,
  type BatchView,
  type usePrototypeEmissions,
} from "./prototype-emissions-shared";
import { PanelPreview, SUBTITLE } from "./prototype-variant-a";

type Data = ReturnType<typeof usePrototypeEmissions>;
type Sheet = ReturnType<typeof useEntrySheet>;

export function VariantB({ data, batchId }: { data: Data; batchId?: string }) {
  const view = batchId ? data.batches.find((b) => b.batch.id === batchId) : undefined;
  return (
    <div className="container-max page-shell">
      <div className={cn(view && "hidden md:block")}>
        <PageHeader area="infrastructure" title="Emissions" subtitle={SUBTITLE} />
      </div>
      <div className="grid grid-cols-1 gap-24 md:grid-cols-[264px_minmax(0,1fr)]">
        <BatchRail data={data} selectedId={view?.batch.id} className={cn(view && "hidden md:flex")} />
        {view ? <TaskPane view={view} data={data} /> : <OverviewPane data={data} />}
      </div>
    </div>
  );
}

function BatchRail({ data, selectedId, className }: { data: Data; selectedId?: string; className?: string }) {
  const href = useEmissionsHref();
  return (
    <nav aria-label="Credit batches" className={cn("flex flex-col self-start [border:var(--panel-border)] bg-[var(--paper)] md:sticky md:top-24", className)}>
      <p className="[border-bottom:var(--row-divider)] px-16 py-12 body-small font-medium text-[var(--color-text-secondary)]">Credit batches</p>
      <ul className="flex flex-col">
        {data.batches.map(({ batch, open }) => {
          const selected = batch.id === selectedId;
          return (
            <li key={batch.id}>
              <Link
                href={href(batch.id)}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "flex min-h-56 items-center gap-12 border-l-4 px-16 py-10 hover:bg-[var(--row-hover-bg-solid)]",
                  selected ? "border-l-[var(--acc-dist)] bg-[var(--row-hover-bg-solid)]" : "border-l-transparent",
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="body-small font-medium">{batch.code}</span>
                  <span className="body-caption text-[var(--color-text-tertiary)]">{batchPeriod(batch)}</span>
                </span>
                {open.length ? (
                  <span className="flex h-24 min-w-24 items-center justify-center rounded-full bg-[var(--st-wait-bg)] px-8 body-caption font-medium tabular-nums text-[var(--color-text-primary)]" aria-label={openCountText(open.length)}>
                    {open.length}
                  </span>
                ) : (
                  <CheckCircleIcon size={20} weight="fill" className="text-[var(--st-ok)]" aria-label="Nothing open" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function OverviewPane({ data }: { data: Data }) {
  const [totalsOpen, setTotalsOpen] = useState(false);
  const openTotal = data.batches.reduce((sum, b) => sum + b.open.length, 0);
  const waiting = data.batches.filter((b) => b.open.length).length;
  return (
    <div className="flex flex-col gap-24">
      <div className="hidden md:block">
      <EmptyState
        padding="md"
        icon={<CircleIcon size={32} weight="bold" />}
        title="Pick a credit batch"
        description={openTotal ? `${openTotal} lines are open across ${waiting} credit ${waiting === 1 ? "batch" : "batches"}.` : "Every line is recorded."}
      />
      </div>
      <div className="flex flex-col gap-12">
        <DisclosureButton open={totalsOpen} onToggle={() => setTotalsOpen((o) => !o)} className="self-start">Facility activity totals</DisclosureButton>
        {totalsOpen && <ActivityTotals batches={data.batches} facilityName={data.facilityName} />}
      </div>
    </div>
  );
}

function TaskPane({ view, data }: { view: BatchView; data: Data }) {
  const sheet = useEntrySheet();
  const [showDone, setShowDone] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const done = view.lines.filter((line) => !line.open);
  return (
    <section aria-labelledby="task-pane-title" className="flex min-w-0 flex-col gap-20">
      <div className="flex flex-col gap-4">
        <EmissionsBreadcrumb code={view.batch.code} />
        <div className="flex flex-wrap items-end justify-between gap-12">
          <div className="flex flex-col gap-4">
            <h2 id="task-pane-title" className="title-heading-3">
              {view.open.length ? `${view.open.length} of ${view.lines.length} lines need you` : `All ${view.lines.length} lines are done`}
            </h2>
            <p className="body-small text-[var(--color-text-secondary)]">{`${batchPeriod(view.batch)}. ${PROTOTYPE_TEMPLATE_NAME}.`}</p>
          </div>
          <Button size="small" variant="weak" aria-pressed={panelOpen} onClick={() => setPanelOpen((o) => !o)}>Batch sheet panel</Button>
        </div>
      </div>
      {panelOpen && <PanelPreview view={view} />}
      {view.open.length > 0 && (
        <ol className="flex flex-col gap-8">
          {view.open.map((line) => <Task key={line.def.id} line={line} view={view} sheet={sheet} />)}
        </ol>
      )}
      {done.length > 0 && (
        <div className="flex flex-col gap-8">
          <DisclosureButton open={showDone} onToggle={() => setShowDone((s) => !s)} className="self-start">
            {showDone ? `Hide ${done.length} done lines` : `Show ${done.length} done lines`}
          </DisclosureButton>
          {showDone && <DoneList lines={done} view={view} sheet={sheet} />}
        </div>
      )}
      <EntrySheet sheet={sheet} batches={data.batches} />
    </section>
  );
}

function taskReason(line: PrototypeLine): string {
  if (line.state === "missingEvidence") {
    const entry = line.values.find((e) => !e.files.length);
    return entry ? `${entryText(line.def, entry)} on ${formatDate(entry.date)} has no file.` : "An entry has no file.";
  }
  return "";
}

function Task({ line, view, sheet }: { line: PrototypeLine; view: BatchView; sheet: Sheet }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const show = (mode: "add" | "edit" | "again" | "nothing") =>
    sheet.show({ batchId: view.batch.id, lineId: line.def.id, mode, entryId: mode === "edit" ? line.values.find((e) => !e.files.length)?.id : undefined });
  const reason = taskReason(line);
  return (
    <li className="flex gap-12 [border:var(--panel-border)] bg-[var(--paper)] px-16 py-16 sm:px-20">
      <CircleIcon size={20} weight="bold" className="mt-12 shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-10">
        <div className="flex items-center gap-12">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-12 gap-y-6">
            <h3 className="body-medium font-medium">{line.def.name}</h3>
            <LineStateBadge state={line.state} />
          </div>
          <DisclosureButton open={detailsOpen} onToggle={() => setDetailsOpen((o) => !o)} className="shrink-0">Details</DisclosureButton>
        </div>
        {reason && <p className="body-small text-[var(--color-text-secondary)]">{reason}</p>}
        {line.state === "needsReview" && <ReviewBlock line={line} batch={view.batch} onEnterAgain={() => show("again")} />}
        {line.state === "needsSetup" && <NeedsSetupText />}
        <div className="flex flex-wrap items-center gap-8 empty:hidden">
          {line.state === "empty" && line.def.rule !== "none" && (
            <>
              <Button size="small" variant="primary" onClick={() => show("add")}>Add entry</Button>
              <Button size="small" variant="weak" onClick={() => show("nothing")}>Nothing to record</Button>
            </>
          )}
          {line.state === "missingEvidence" && <Button size="small" variant="primary" onClick={() => show("edit")}>Add file</Button>}
          {line.state === "needsSetup" && view.batch.real && (
            <Link href={creditBatchSheetHref(view.batch)} className="inline-flex h-[32px] items-center border border-[var(--color-border-primary)] px-12 label-button">Open credit batch</Link>
          )}
        </div>
        {detailsOpen && (
          <div className="[border-top:var(--row-divider)] pt-12">
            <LineDetails line={line} />
          </div>
        )}
      </div>
    </li>
  );
}

function DoneList({ lines, view, sheet }: { lines: PrototypeLine[]; view: BatchView; sheet: Sheet }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <ul className="flex flex-col [border:var(--panel-border)] bg-[var(--paper)]">
      {lines.map((line) => {
        const isOpen = expanded === line.def.id;
        return (
          <li key={line.def.id} className="[border-top:var(--row-divider)] first:[border-top:none]">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setExpanded(isOpen ? null : line.def.id)}
              className="flex min-h-44 w-full items-center gap-12 px-16 py-8 text-left hover:bg-[var(--row-hover-bg-solid)] sm:px-20"
            >
              <CheckCircleIcon size={20} weight="fill" className="shrink-0 text-[var(--st-ok)]" aria-hidden="true" />
              <span className="min-w-0 flex-1 body-small">{line.def.name}</span>
              <span className="hidden shrink-0 body-small tabular-nums text-[var(--color-text-secondary)] sm:inline">{line.totalText}</span>
            </button>
            {isOpen && (
              <div className="flex flex-col gap-12 bg-[var(--sea)] px-16 py-12 sm:px-20 sm:pl-48">
                <div className="flex items-center gap-12">
                  <LineStateBadge state={line.state} />
                  <span className="body-small tabular-nums">{line.totalText}</span>
                </div>
                <LineDetails line={line} onAdd={() => sheet.show({ batchId: view.batch.id, lineId: line.def.id, mode: "add" })} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
