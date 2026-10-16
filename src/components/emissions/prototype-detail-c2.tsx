/**
 * PROTOTYPE detail C2, "Split view": a compact line ledger on the left (name,
 * state, total) and a persistent detail pane on the right for the selected
 * line. The pane replaces the overlay sheet: the next action runs inline, and
 * earlier entries, figures from records and the line description are folded.
 *
 * Selection lives in the URL (`line=<id>`). Up/Down or j/k move it while focus
 * is in the ledger. After an action the selection advances to the next open
 * line. Below lg the pane is a full-screen view with a back link. Built on the
 * shared detail API in prototype-detail-shared.tsx.
 */
"use client";

import { Fragment, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { parseAsString, useQueryState } from "nuqs";
import { ArrowLeftIcon, CheckCircleIcon, PaperclipIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField } from "@/components/forms";
import { Button, EmptyState, Input, PageHeader } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { GAS_INPUTS, PROTOTYPE_TEMPLATE_NAME, entryText, formatFigure, formatNumber, prototypeActions, type EntryDraft, type PrototypeEntry, type PrototypeLine } from "./prototype-emissions-data";
import {
  DisclosureButton,
  EntryList,
  LineStateBadge,
  NeedsSetupText,
  batchPeriod,
  creditBatchSheetHref,
  type usePrototypeEmissions,
} from "./prototype-emissions-shared";
import {
  DetailKpiStrip,
  DetailTopBar,
  LineSortSelect,
  LineStateChips,
  NoLinesMatch,
  useBatchDetail,
  type BatchDetail,
} from "./prototype-detail-shared";

type Data = ReturnType<typeof usePrototypeEmissions>;
const TODAY = new Date().toISOString().slice(0, 10);
const LG_MIN_WIDTH = 1024;
const TEXT_LINK = "inline-flex min-h-44 items-center body-small font-medium text-[var(--color-text-interaction-primary)] underline underline-offset-4";
const RULE_TEXT = {
  additive: "Entries add to the figures from records.",
  single: "One entry per credit batch.",
  none: "Filled from records. It takes no entries.",
} as const;

export const DETAIL_C2_NAME = "Split view";

export function DetailC2({ data, batchId }: { data: Data; batchId: string }) {
  const detail = useBatchDetail(data, batchId);
  const { view, lines, groups, grouped } = detail;
  const [lineParam, setLineParam] = useQueryState("line", parseAsString.withOptions({ history: "push", scroll: false }));
  const explicit = view.lines.find((line) => line.def.id === lineParam) ?? null;
  const firstOpen = lines.find((line) => line.open) ?? view.open[0] ?? null;
  const selected = explicit ?? firstOpen;

  const select = (id: string | null, replace = false) => {
    void setLineParam(id, { history: replace ? "replace" : "push" });
    if (id && typeof window !== "undefined" && window.innerWidth < LG_MIN_WIDTH) window.scrollTo({ top: 0 });
  };
  /** The next open line after `lineId` in the visible order, wrapping round. */
  const nextOpenAfter = (lineId: string): PrototypeLine | null => {
    const at = lines.findIndex((line) => line.def.id === lineId);
    const ordered = [...lines.slice(at + 1), ...lines.slice(0, Math.max(at, 0))];
    return ordered.find((line) => line.open && line.def.id !== lineId) ?? null;
  };
  const advance = (lineId: string) => select(nextOpenAfter(lineId)?.def.id ?? null, true);

  const onListKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const step = event.key === "ArrowDown" || event.key === "j" ? 1 : event.key === "ArrowUp" || event.key === "k" ? -1 : 0;
    if (!step) return;
    const at = lines.findIndex((line) => line.def.id === selected?.def.id);
    const target = lines[Math.min(lines.length - 1, Math.max(0, (at < 0 ? (step > 0 ? -1 : lines.length) : at) + step))];
    if (!target) return;
    event.preventDefault();
    select(target.def.id);
    event.currentTarget.querySelector<HTMLElement>(`[data-line-id="${target.def.id}"]`)?.focus();
  };

  const row = (line: PrototypeLine, showGroup: boolean) => (
    <LedgerItem key={line.def.id} line={line} selected={line.def.id === selected?.def.id} showGroup={showGroup} onSelect={() => select(line.def.id)} />
  );

  // Phones show either the ledger or the pane, never both.
  const paneOnly = !!explicit;
  return (
    <div className="container-max page-shell">
      <div className="flex flex-col gap-4">
        <DetailTopBar view={view} batches={data.batches} />
        <PageHeader title={view.batch.code} subtitle={`${batchPeriod(view.batch)}. ${PROTOTYPE_TEMPLATE_NAME}.`} />
      </div>
      <div className={cn(paneOnly && "hidden lg:block")}>
        <DetailKpiStrip detail={detail} />
      </div>

      <div className={cn("flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between", paneOnly && "hidden lg:flex")}>
        <LineStateChips detail={detail} />
        <LineSortSelect detail={detail} />
      </div>

      <div className="grid items-start gap-16 lg:grid-cols-[minmax(360px,5fr)_7fr] lg:gap-24">
        <div className={cn("flex min-w-0 flex-col gap-12", paneOnly && "hidden lg:flex")}>
          <div className="[border:var(--panel-border)] bg-[var(--paper)]">
            {lines.length === 0 ? (
              <div className="p-16"><NoLinesMatch detail={detail} /></div>
            ) : (
              // Arrow keys move the selection between the row buttons below.
              <div onKeyDown={onListKeys} role="group" aria-label="Lines, use arrow keys to move">
                {grouped
                  ? groups.map((group) => (
                      <Fragment key={group.group}>
                        <p className="[border-top:var(--row-divider)] px-16 pt-12 pb-4 body-caption font-medium text-[var(--color-text-tertiary)] first:[border-top:none]">{group.group}</p>
                        {group.lines.map((line) => row(line, false))}
                      </Fragment>
                    ))
                  : lines.map((line) => row(line, true))}
              </div>
            )}
          </div>
        </div>

        <section
          aria-label="Selected line"
          className={cn("min-w-0 [border:var(--panel-border)] bg-[var(--paper)] lg:sticky lg:top-16 lg:max-h-[calc(100vh-32px)] lg:overflow-y-auto", !paneOnly && "hidden lg:block")}
        >
          {selected ? (
            <LinePane key={selected.def.id} line={selected} detail={detail} nextName={nextOpenAfter(selected.def.id)?.def.name ?? null} onBack={() => select(null)} onDone={() => advance(selected.def.id)} />
          ) : (
            <div className="p-24">
              <EmptyState
                padding="md"
                icon={<CheckCircleIcon size={32} weight="bold" />}
                title="Every line is done"
                description={`No line in ${view.batch.code} needs an entry. Pick a line to see its details.`}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* ---------- ledger ---------- */

function LedgerItem({ line, selected, showGroup, onSelect }: { line: PrototypeLine; selected: boolean; showGroup: boolean; onSelect: () => void }) {
  const muted = !line.values.length && !line.auto && !line.nothing;
  return (
    <button
      type="button"
      data-line-id={line.def.id}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        "flex min-h-44 w-full flex-col gap-4 px-16 py-10 text-left [border-top:var(--row-divider)] first:[border-top:none] hover:bg-[var(--row-hover-bg-solid)]",
        selected && "bg-[var(--sea)] [box-shadow:inset_3px_0_0_var(--color-interaction)]",
        !selected && line.open && "bg-[var(--st-wait-bg)]/40",
      )}
    >
      <span className="body-small font-medium">{line.def.name}</span>
      {showGroup && <span className="body-caption text-[var(--color-text-tertiary)]">{line.def.group}</span>}
      <span className="flex items-center justify-between gap-12">
        <LineStateBadge state={line.state} />
        <span className={cn("body-small tabular-nums", muted ? "text-[var(--color-text-tertiary)]" : "text-[var(--color-text-secondary)]")}>
          {line.state === "needsReview" ? "" : line.totalText}
        </span>
      </span>
    </button>
  );
}

/* ---------- pane ---------- */

interface PaneProps {
  line: PrototypeLine;
  detail: BatchDetail;
  nextName: string | null;
  onBack: () => void;
  onDone: () => void;
}

function LinePane({ line, detail, nextName, onBack, onDone }: PaneProps) {
  const { view, actions } = detail;
  const { def } = line;
  const [open, setOpen] = useState<"entries" | "records" | "about" | null>(null);
  const [again, setAgain] = useState(false);
  const [addAnother, setAddAnother] = useState(false);
  const toggle = (key: "entries" | "records" | "about") => setOpen(open === key ? null : key);
  const gas = def.shape === "gas";

  let action: ReactNode = null;
  if (line.state === "needsReview") {
    const entry = line.review[0];
    action = (
      <div className="flex flex-col gap-12">
        {entry && (
          <p className="body-small">
            <span className="font-medium tabular-nums">{entryText(def, entry)}</span>
            <span className="text-[var(--color-text-secondary)]">{` on ${formatDate(entry.date)}. The template line changed after this entry, so it does not count until you confirm it.`}</span>
          </p>
        )}
        {again ? (
          <EntryFormInline key="again" line={line} detail={detail} seed={entry} replaceIds={line.review.map((e) => e.id)} nextName={nextName} onCancel={() => setAgain(false)} onDone={onDone} />
        ) : (
          <div className="flex flex-wrap gap-8">
            <Button variant="primary" onClick={() => { actions.confirm(def.id); onDone(); }}>Confirm</Button>
            <Button variant="weak" onClick={() => setAgain(true)}>Enter again</Button>
          </div>
        )}
      </div>
    );
  } else if (line.state === "missingEvidence") {
    action = <AddFileForm line={line} detail={detail} nextName={nextName} onDone={onDone} />;
  } else if (line.state === "needsSetup") {
    action = (
      <div className="flex flex-col gap-8">
        <NeedsSetupText />
        {view.batch.real && <div><Link href={creditBatchSheetHref(view.batch)} className={TEXT_LINK}>Open credit batch</Link></div>}
      </div>
    );
  } else if (line.state === "empty" && def.rule !== "none") {
    action = <EntryFormInline key="add" line={line} detail={detail} offerNothing nextName={nextName} onDone={onDone} />;
  } else if (line.state === "empty") {
    action = <p className="body-small text-[var(--color-text-secondary)]">This line fills from records. Nothing to enter.</p>;
  } else {
    const canAdd = def.rule === "additive";
    action = (
      <div className="flex flex-col gap-8">
        <p className="inline-flex items-center gap-6 body-small text-[var(--color-text-secondary)]">
          <CheckCircleIcon size={16} weight="bold" aria-hidden="true" />
          {line.state === "nothingToRecord" ? `Nothing to record. ${line.nothing?.note ?? ""}` : "Nothing more to do on this line."}
        </p>
        {canAdd && (addAnother ? (
          <EntryFormInline key="another" line={line} detail={detail} nextName={null} onCancel={() => setAddAnother(false)} onDone={() => { setAddAnother(false); }} />
        ) : (
          <div><Button size="small" variant="weak" onClick={() => setAddAnother(true)}>Add another entry</Button></div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-8 px-20 pt-16 pb-16 [border-bottom:var(--row-divider)] sm:px-24">
        <button type="button" onClick={onBack} className="-ml-8 inline-flex min-h-44 items-center gap-6 self-start px-8 body-small font-medium text-[var(--color-text-interaction-primary)] hover:bg-[var(--color-surface-medium)] lg:hidden">
          <ArrowLeftIcon size={16} weight="bold" aria-hidden="true" />
          Back to lines
        </button>
        <span className="body-caption text-[var(--color-text-tertiary)]">{def.group}</span>
        <h2 className="body-large font-medium">{def.name}</h2>
        <div className="flex flex-wrap items-center justify-between gap-x-16 gap-y-6">
          <LineStateBadge state={line.state} />
          <span className="body-large font-medium tabular-nums">{line.state === "needsReview" ? "Not counted" : line.totalText}</span>
        </div>
      </div>

      <div className="flex flex-col gap-4 px-20 py-16 sm:px-24">
        {action}
      </div>

      <div className="flex flex-col px-20 pb-16 sm:px-24 [border-top:var(--row-divider)]">
        <DisclosureButton open={open === "entries"} onToggle={() => toggle("entries")}>{`Earlier entries (${line.entries.length})`}</DisclosureButton>
        {open === "entries" && <div className="pb-8 pl-24"><EntryList line={line} /></div>}
        {def.recordsLabel && (
          <>
            <DisclosureButton open={open === "records"} onToggle={() => toggle("records")}>Figures from records</DisclosureButton>
            {open === "records" && (
              <p className="pb-8 pl-24 body-small">
                {line.auto ? `${formatFigure(line.auto.value, def.unit)} from ${def.recordsLabel.toLowerCase()} (${line.auto.detail})` : `None yet from ${def.recordsLabel.toLowerCase()}`}
              </p>
            )}
          </>
        )}
        <DisclosureButton open={open === "about"} onToggle={() => toggle("about")}>About this line</DisclosureButton>
        {open === "about" && (
          <div className="flex flex-col gap-10 pb-8 pl-24">
            <p className="body-small whitespace-pre-line text-[var(--color-text-secondary)]">{def.description}</p>
            {gas && <p className="body-small">{`Dry feedstock in ${view.batch.code}: ${formatNumber(view.batch.dryFeedstockT)} t`}</p>}
            <dl className="grid grid-cols-[96px_1fr] gap-x-16 gap-y-4 body-small">
              <dt className="text-[var(--color-text-secondary)]">Unit</dt>
              <dd>{def.unit}</dd>
              <dt className="text-[var(--color-text-secondary)]">Entry rule</dt>
              <dd>{RULE_TEXT[def.rule]}</dd>
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- inline forms ---------- */

const FIELD = "w-full sm:max-w-[320px]";

function FilePick({ file, onChange }: { file: string | null; onChange: (name: string | null) => void }) {
  return (
    <label className="inline-flex min-h-44 w-full cursor-pointer items-center gap-8 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-12 body-small focus-within:border-[var(--color-interaction)] sm:max-w-[320px]">
      <PaperclipIcon size={16} weight="bold" aria-hidden="true" />
      <span className="min-w-0 truncate">{file ?? "Attach file"}</span>
      <input type="file" aria-label="File" className="sr-only" onChange={(e) => onChange(e.target.files?.[0]?.name ?? null)} />
    </label>
  );
}

function FormFooter({ children, nextName, error }: { children: ReactNode; nextName: string | null; error: string | null }) {
  return (
    <>
      {error && <p role="alert" className="body-caption text-[var(--st-bad)]">{error}</p>}
      <div className="flex flex-wrap items-center gap-x-16 gap-y-4">
        {children}
        {nextName && <span className="body-caption text-[var(--color-text-tertiary)]">{`Then opens ${nextName}.`}</span>}
      </div>
    </>
  );
}

interface EntryFormProps {
  line: PrototypeLine;
  detail: BatchDetail;
  seed?: PrototypeEntry;
  replaceIds?: string[];
  offerNothing?: boolean;
  nextName: string | null;
  onCancel?: () => void;
  onDone: () => void;
}

function EntryFormInline({ line, detail, seed, replaceIds = [], offerNothing = false, nextName, onCancel, onDone }: EntryFormProps) {
  const { view, actions } = detail;
  const { def } = line;
  const defaultDate = view.batch.endDate < TODAY ? view.batch.endDate : TODAY;
  const [nothing, setNothing] = useState(false);
  const [a, setA] = useState(String((def.shape === "gas" ? seed?.concentration : def.shape === "massDistance" ? seed?.mass : seed?.value) ?? ""));
  const [b, setB] = useState(String((def.shape === "gas" ? seed?.massFlow : seed?.distance) ?? ""));
  const [date, setDate] = useState(seed?.date ?? defaultDate);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const valid = (raw: string) => /^\d+(?:\.\d+)?$/.test(raw.trim());
  const paired = def.shape === "gas" || def.shape === "massDistance";
  const labels = def.shape === "gas" ? GAS_INPUTS.map((i) => [i.label, i.unit]) : def.shape === "massDistance" ? [["Mass", "kg"], ["Distance", "km"]] : [[def.inputLabel, def.unit]];
  const month = new Date(`${view.batch.startDate}T00:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const id = `c2-${def.id}`;

  const save = () => {
    if (nothing) {
      if (!note.trim()) return setError("Enter a note that says why there is nothing to record.");
      actions.nothingToRecord(def.id, note.trim(), date);
      return onDone();
    }
    if (!valid(a) || (paired && !valid(b))) return setError("Enter a non-negative decimal value.");
    if (date < view.batch.startDate) return setError("Entry date cannot be before the credit batch start date.");
    const amounts = def.shape === "gas" ? { concentration: Number(a), massFlow: Number(b) } : def.shape === "massDistance" ? { mass: Number(a), distance: Number(b) } : { value: Number(a) };
    const draft: EntryDraft = { kind: "value", date, note: "", files: file ? [file] : [], ...amounts };
    if (replaceIds.length) {
      prototypeActions.addEntry(view.batch, def.id, draft, replaceIds);
      toast.success(`Entry saved on ${def.name}.`);
    } else actions.addEntry(def.id, draft);
    onDone();
  };

  return (
    <div className="flex flex-col gap-12">
      {nothing ? (
        <div className={FIELD}>
          <FormField id={`${id}-note`} label="Note" required>
            <Input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} placeholder={`For example: No staff flights in ${month}`} autoFocus />
          </FormField>
        </div>
      ) : (
        labels.map(([label, unit], index) => (
          <div key={label} className={FIELD}>
            <FormField id={`${id}-${index}`} label={label} unit={unit}>
              <Input id={`${id}-${index}`} inputMode="decimal" value={index === 0 ? a : b} onChange={(e) => (index === 0 ? setA : setB)(e.target.value)} />
            </FormField>
          </div>
        ))
      )}
      <div className={FIELD}>
        <FormField id={`${id}-date`} label="Date">
          <Input id={`${id}-date`} type="date" value={date} min={view.batch.startDate} max={TODAY} onChange={(e) => setDate(e.target.value)} />
        </FormField>
      </div>
      {!nothing && <FilePick file={file} onChange={setFile} />}
      {!nothing && !file && !def.yearlyReport && <p className="-mt-6 body-caption text-[var(--color-text-tertiary)]">You can save without a file. The line then reads File missing.</p>}
      <FormFooter nextName={nextName} error={error}>
        <Button variant="primary" onClick={save}>{nothing ? "Mark nothing to record" : "Save entry"}</Button>
        {onCancel && <Button variant="weak" onClick={onCancel}>Cancel</Button>}
        {offerNothing && (
          <button type="button" onClick={() => { setNothing((n) => !n); setError(null); }} className={TEXT_LINK}>
            {nothing ? "Enter a value instead" : "Nothing to record"}
          </button>
        )}
      </FormFooter>
    </div>
  );
}

function AddFileForm({ line, detail, nextName, onDone }: { line: PrototypeLine; detail: BatchDetail; nextName: string | null; onDone: () => void }) {
  const toast = useToast();
  const entry = line.values.find((e) => !e.files.length);
  const [file, setFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!entry) return null;
  const save = () => {
    if (!file) return setError("Attach a file to save.");
    const draft: EntryDraft = { ...entry, files: [file] };
    prototypeActions.updateEntry(detail.view.batch, entry.id, draft);
    toast.success(`File added on ${line.def.name}.`);
    onDone();
  };
  return (
    <div className="flex flex-col gap-12">
      <p className="body-small">
        <span className="font-medium tabular-nums">{entryText(line.def, entry)}</span>
        <span className="text-[var(--color-text-secondary)]">{` on ${formatDate(entry.date)} has no file.`}</span>
      </p>
      <FilePick file={file} onChange={setFile} />
      <FormFooter nextName={nextName} error={error}>
        <Button variant="primary" onClick={save}>Add file</Button>
      </FormFooter>
    </div>
  );
}
