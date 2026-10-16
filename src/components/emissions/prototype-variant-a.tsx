/**
 * PROTOTYPE variant A, "Checklist". Overview: one plain list of credit
 * batches, each with a strip of one tick per template line. Sub-route: a
 * checklist, "Needs you" first and "Done" collapsed. Each row shows name,
 * state, total and one next action; the rest opens under the row.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, PageHeader, RowActionsMenu, StatusBadge } from "@/components/ui";
import {
  SlideOverPanelBody,
  SlideOverPanelContent,
  SlideOverPanelHeader,
  SlideOverPanelRoot,
  SlideOverPanelTitle,
} from "@/components/ui/slide-over-panel";
import { cn } from "@/lib/utils";
import { PROTOTYPE_TEMPLATE_NAME, type PrototypeLine, type PrototypeLineState } from "./prototype-emissions-data";
import {
  ActivityTotals,
  BatchSheetEmissionsPanel,
  DisclosureButton,
  EmissionsBreadcrumb,
  EntrySheet,
  LineDetails,
  LineStateBadge,
  NeedsSetupText,
  ReviewBlock,
  batchPeriod,
  creditBatchSheetHref,
  nextAction,
  openCountText,
  useEmissionsHref,
  useEntrySheet,
  type BatchView,
  type usePrototypeEmissions,
} from "./prototype-emissions-shared";

type Data = ReturnType<typeof usePrototypeEmissions>;
export const SUBTITLE = "Every line your credit batches' Removal templates ask for.";

const TICK_TONE: Record<PrototypeLineState, string> = {
  filled: "bg-[var(--st-ok)]",
  nothingToRecord: "bg-[var(--st-ok)]",
  confirmedZero: "bg-[var(--st-ok)]",
  empty: "bg-[var(--st-off-border)]",
  missingEvidence: "bg-[var(--st-wait)]",
  needsReview: "bg-[var(--st-wait)]",
  needsSetup: "bg-[var(--st-bad)]",
};

function LineTicks({ lines }: { lines: PrototypeLine[] }) {
  return (
    <div className="flex gap-2" aria-hidden="true">
      {lines.map((line) => (
        <span key={line.def.id} title={`${line.def.name}: ${line.state}`} className={cn("h-8 flex-1", TICK_TONE[line.state])} />
      ))}
    </div>
  );
}

export function VariantA({ data, batchId }: { data: Data; batchId?: string }) {
  return batchId ? <ChecklistPage data={data} batchId={batchId} /> : <BatchListPage data={data} />;
}

function BatchListPage({ data }: { data: Data }) {
  const href = useEmissionsHref();
  const [totalsOpen, setTotalsOpen] = useState(false);
  return (
    <div className="container-max page-shell">
      <PageHeader
        area="infrastructure"
        title="Emissions"
        subtitle={SUBTITLE}
        actions={<Button variant="weak" onClick={() => setTotalsOpen(true)}>Activity totals</Button>}
      />
      <ul className="flex flex-col [border:var(--panel-border)] bg-[var(--paper)]">
        {data.batches.map(({ batch, lines, open }) => (
          <li key={batch.id} className="[border-top:var(--row-divider)] first:[border-top:none]">
            <Link href={href(batch.id)} className="group flex items-center gap-16 px-20 py-16 hover:bg-[var(--row-hover-bg-solid)]">
              <div className="flex min-w-0 flex-1 flex-col gap-10">
                <div className="flex flex-wrap items-baseline gap-x-16 gap-y-4">
                  <span className="body-medium font-medium text-[var(--acc-dist-ink)]">{batch.code}</span>
                  <span className="body-small text-[var(--color-text-secondary)]">{batchPeriod(batch)}</span>
                  <StatusBadge status={batch.status} size="small" />
                </div>
                <LineTicks lines={lines} />
              </div>
              <span className={cn("shrink-0 body-small tabular-nums", open.length ? "font-medium" : "text-[var(--color-text-tertiary)]")}>
                {openCountText(open.length)}
              </span>
              <CaretRightIcon size={16} weight="bold" className="shrink-0 text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-primary)]" />
            </Link>
          </li>
        ))}
      </ul>
      <SlideOverPanelRoot open={totalsOpen} onOpenChange={setTotalsOpen}>
        <SlideOverPanelContent size="wide">
          <SlideOverPanelHeader>
            <SlideOverPanelTitle>Activity totals</SlideOverPanelTitle>
          </SlideOverPanelHeader>
          <SlideOverPanelBody>
            <ActivityTotals batches={data.batches} facilityName={data.facilityName} />
          </SlideOverPanelBody>
        </SlideOverPanelContent>
      </SlideOverPanelRoot>
    </div>
  );
}

function ChecklistPage({ data, batchId }: { data: Data; batchId: string }) {
  const view = data.batches.find((b) => b.batch.id === batchId)!;
  const sheet = useEntrySheet();
  const [doneOpen, setDoneOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const done = view.lines.filter((line) => !line.open);
  return (
    <div className="container-max page-shell">
      <div className="flex flex-col gap-4">
        <EmissionsBreadcrumb code={view.batch.code} />
        <PageHeader
          title={view.batch.code}
          subtitle={`${batchPeriod(view.batch)}. ${PROTOTYPE_TEMPLATE_NAME}.`}
          actions={<Button variant="weak" aria-pressed={panelOpen} onClick={() => setPanelOpen((o) => !o)}>Batch sheet panel</Button>}
        />
      </div>
      {panelOpen && <PanelPreview view={view} />}

      <section aria-labelledby="needs-you" className="flex flex-col gap-12">
        <h2 id="needs-you" className="title-heading-3">{view.open.length ? `Needs you (${view.open.length})` : "Nothing needs you"}</h2>
        {view.open.length > 0 && <ChecklistRows view={view} lines={view.open} sheet={sheet} />}
      </section>

      {done.length > 0 && (
        <section aria-label="Done" className="flex flex-col gap-12">
          <DisclosureButton open={doneOpen} onToggle={() => setDoneOpen((o) => !o)} className="self-start body-medium">
            {`Done (${done.length})`}
          </DisclosureButton>
          {doneOpen && <ChecklistRows view={view} lines={done} sheet={sheet} />}
        </section>
      )}
      <EntrySheet sheet={sheet} batches={data.batches} />
    </div>
  );
}

export function PanelPreview({ view }: { view: BatchView }) {
  return (
    <div className="flex flex-col gap-8 sm:max-w-[600px]">
      <BatchSheetEmissionsPanel view={view} />
      {view.batch.real ? (
        <Link href={creditBatchSheetHref(view.batch, true)} className="inline-flex min-h-44 items-center self-start body-small font-medium text-[var(--color-text-interaction-primary)] underline underline-offset-4">
          See it in the credit batch sheet
        </Link>
      ) : (
        <p className="body-caption text-[var(--color-text-tertiary)]">This is a stub credit batch, so it has no real sheet.</p>
      )}
    </div>
  );
}

function ChecklistRows({ view, lines, sheet }: { view: BatchView; lines: PrototypeLine[]; sheet: ReturnType<typeof useEntrySheet> }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const show = (line: PrototypeLine, mode: "add" | "edit" | "again" | "nothing") =>
    sheet.show({ batchId: view.batch.id, lineId: line.def.id, mode, entryId: mode === "edit" ? line.values.find((e) => !e.files.length)?.id : undefined });
  return (
    <ul className="flex flex-col [border:var(--panel-border)] bg-[var(--paper)]">
      {lines.map((line) => {
        const action = nextAction(line);
        const isOpen = expanded === line.def.id;
        const canNothing = line.def.rule !== "none" && line.state === "empty";
        return (
          <li key={line.def.id} className="[border-top:var(--row-divider)] first:[border-top:none]">
            <div className="flex flex-col gap-12 px-20 py-12 sm:flex-row sm:items-center">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setExpanded(isOpen ? null : line.def.id)}
                className="flex min-h-44 min-w-0 flex-1 items-center gap-8 text-left"
              >
                <CaretRightIcon size={16} weight="bold" className={cn("shrink-0 text-[var(--color-text-tertiary)] transition-transform", isOpen && "rotate-90")} />
                <span className="body-medium">{line.def.name}</span>
              </button>
              <div className="flex flex-wrap items-center gap-x-12 gap-y-8 pl-24 sm:flex-nowrap sm:pl-0">
                <LineStateBadge state={line.state} />
                <span className="flex-1 body-small tabular-nums text-[var(--color-text-secondary)] sm:w-[120px] sm:flex-none sm:text-right">
                  {line.state === "empty" || line.state === "needsSetup" || line.state === "needsReview" ? "" : line.totalText}
                </span>
                <span className="flex items-center gap-4 sm:w-[160px] sm:justify-end">
                {action && action.mode !== "review" && (
                  action.mode === "setup" ? (
                    view.batch.real ? (
                      <Link href={creditBatchSheetHref(view.batch)} className="inline-flex h-[32px] items-center border border-[var(--color-border-primary)] px-12 label-button">{action.label}</Link>
                    ) : null
                  ) : (
                    <Button size="small" variant="default" onClick={() => show(line, action.mode as "add" | "edit")}>{action.label}</Button>
                  )
                )}
                {canNothing ? (
                  <RowActionsMenu
                    label={`More actions for ${line.def.name}`}
                    actions={[
                      { label: "Nothing to record", onSelect: () => show(line, "nothing") },
                      { label: isOpen ? "Hide details" : "Show details", onSelect: () => setExpanded(isOpen ? null : line.def.id) },
                    ]}
                  />
                ) : (
                  <span className="hidden w-[32px] sm:block" aria-hidden="true" />
                )}
                </span>
              </div>
            </div>
            {line.state === "needsReview" && (
              <div className="px-20 pb-16 pl-44">
                <ReviewBlock line={line} batch={view.batch} onEnterAgain={() => show(line, "again")} />
              </div>
            )}
            {line.state === "needsSetup" && (
              <div className="px-20 pb-16 pl-44"><NeedsSetupText /></div>
            )}
            {isOpen && (
              <div className="[border-top:var(--row-divider)] bg-[var(--sea)] px-20 py-16 sm:pl-44">
                <LineDetails line={line} onAdd={() => show(line, "add")} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
