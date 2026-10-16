/**
 * PROTOTYPE C3a "Equation columns", part 2 of 2: the three equation cells
 * (From records, Entries, Total) that the read table, the cards, the bulk
 * grid and the forms all share, and the line panel. The panel has two views
 * in one SlideOverPanel: the ledger (C3c's "From records + Entries = Total"
 * with a ⋯ per entry) and the entry form (the same equation, Entries
 * editable, the total before and after as two blocks and an arrow).
 * Records from forms are read only here: they link to their source page.
 */
"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  DotsThreeVerticalIcon,
  FileIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { FormField, FormFileUpload, FormTextarea, type DeferredFileEntry } from "@/components/forms";
import {
  Button,
  DropdownMenu,
  Input,
  Notice,
  SlideOverPanelBody,
  SlideOverPanelContent,
  SlideOverPanelDescription,
  SlideOverPanelFooter,
  SlideOverPanelHeader,
  SlideOverPanelRoot,
  SlideOverPanelTitle,
} from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import {
  GAS_INPUTS,
  entryAmount,
  entryText,
  formatFigure,
  formatNumber,
  prototypeActions,
  type EntryDraft,
  type PrototypeBatch,
  type PrototypeEntry,
  type PrototypeLine,
} from "./prototype-emissions-data";
import { DisclosureButton, LineStateBadge, ProtoNote, ReviewBlock, YEARLY_REPORT_FILE, type BatchView } from "./prototype-emissions-shared";
import {
  entriesText,
  lineCase,
  nothingToRecordRefusal,
  recordsSource,
  recordsText,
  rowMenuItems,
} from "./prototype-line-sources";

const KG_PER_TONNE = 1000;
export const TODAY = new Date().toISOString().slice(0, 10);
const MSG_NUMBER = "Enter a non-negative decimal value.";
const SETUP_TEXT = "An admin sets up this line in the template review.";
const ISOMETRIC_ZERO = "Isometric receives 0 for this line, with no file. The note stays in noma.";
const LINK = "inline-flex items-center gap-4 text-[var(--color-text-interaction-primary)] underline underline-offset-4 hover:text-[var(--color-text-primary)]";
const MUTED = "text-[var(--color-text-tertiary)]";

export { SETUP_TEXT };

/* ---------- small pure helpers ---------- */

export function defaultEntryDate(batch: PrototypeBatch): string {
  return batch.endDate < TODAY ? batch.endDate : TODAY;
}
/** The records source exists but holds nothing for this line (B1, B2, F, and Z on such a line). */
export function hasRecordsGap(line: PrototypeLine): boolean {
  return line.def.rule === "additive" && !!line.records && line.records.value == null;
}
/** Nothing to record applies at all (Z already is it; R and Needs setup never take it). */
export function nothingApplies(line: PrototypeLine): boolean {
  const kind = lineCase(line);
  return kind !== "Z" && kind !== "R" && line.state !== "needsSetup";
}
export function parseAmount(raw: string): number | null {
  return /^\d+(?:\.\d+)?$/.test(raw.trim()) ? Number(raw) : null;
}
const sumValues = (line: PrototypeLine) => line.values.reduce((sum, entry) => sum + entryAmount(line.def, entry), 0);

/** "18,420 kWh from 22 production runs" as figure and source, so the cell can stack them. */
function recordsParts(line: PrototypeLine): { figure: string | null; source: string } {
  const text = recordsText(line);
  const source = recordsSource(line);
  const at = text.indexOf(" from ");
  if (source.kind === "records" && source.value != null && at > 0) return { figure: text.slice(0, at), source: text.slice(at + " from ".length) };
  return { figure: null, source: text };
}
/** "1,460 kWh, 2 entries" as figure and detail. Gas pairs and words stay whole. */
function entriesParts(line: PrototypeLine): { figure: string; detail: string | null } {
  const text = entriesText(line);
  const at = text.lastIndexOf(", ");
  if (line.def.shape === "gas" || at < 0) return { figure: text, detail: null };
  return { figure: text.slice(0, at), detail: text.slice(at + 2) };
}

/* ---------- the three equation cells ---------- */

/** Links inside a clickable row never open the row. */
const stop = (event: React.SyntheticEvent) => event.stopPropagation();

export function RecordsCell({ line, warn = false, align = "right" }: { line: PrototypeLine; warn?: boolean; align?: "left" | "right" }) {
  const source = recordsSource(line);
  const parts = recordsParts(line);
  const box = cn("flex flex-col gap-2", align === "right" ? "items-end text-right" : "items-start text-left");
  if (line.def.rule === "single" || source.kind === "none") return <span className={cn(box, MUTED)}>{parts.source}</span>;
  if (parts.figure) {
    return (
      <span className={box}>
        <span className="tabular-nums">{parts.figure}</span>
        <Link href={source.href} onClick={stop} className={cn(LINK, "body-caption")}>
          {parts.source}
          <ArrowUpRightIcon size={12} weight="bold" aria-hidden="true" />
        </Link>
      </span>
    );
  }
  return (
    <span className={box}>
      <Link href={source.href} onClick={stop} className="body-small text-[var(--color-text-interaction-primary)] underline underline-offset-4 hover:text-[var(--color-text-primary)]">
        {warn && <WarningIcon size={14} weight="bold" className="mr-4 inline-block align-[-2px] text-[var(--st-wait)]" aria-label="Records gap" />}
        {parts.source}
        <ArrowUpRightIcon size={12} weight="bold" aria-hidden="true" className="ml-2 inline-block" />
      </Link>
    </span>
  );
}

export function EntriesCell({ line, onAddNote, align = "right" }: { line: PrototypeLine; onAddNote?: () => void; align?: "left" | "right" }) {
  const box = cn("flex flex-col gap-2", align === "right" ? "items-end text-right" : "items-start text-left");
  const parts = entriesParts(line);
  const missing = line.values.filter((entry) => !entry.files.length).length;
  if (line.def.rule === "none") return <span className={cn(box, MUTED)}>{parts.figure}</span>;
  if (line.nothing && !line.values.length) {
    return (
      <span className={box}>
        <span>{parts.figure}</span>
        <span className="body-caption text-[var(--color-text-secondary)]">
          {parts.detail}
          {!line.nothing.note && onAddNote && (
            <>
              {". "}
              <button type="button" onClick={(event) => { stop(event); onAddNote(); }} className={cn(LINK, "inline")}>Add note</button>
            </>
          )}
        </span>
      </span>
    );
  }
  return (
    <span className={box}>
      {line.values.length > 0 ? (
        <span className="tabular-nums">
          {line.def.shape === "gas" ? parts.figure.split(", ").map((part) => <span key={part} className="block whitespace-nowrap">{part}</span>) : parts.figure}
        </span>
      ) : !line.review.length && <span className={MUTED}>None</span>}
      {parts.detail && <span className="body-caption text-[var(--color-text-secondary)]">{parts.detail}</span>}
      {missing > 0 && (
        <span className="inline-flex items-center gap-4 body-caption text-[var(--st-wait)]">
          <WarningIcon size={12} weight="bold" aria-hidden="true" />
          {missing === line.values.length ? "File missing" : `${missing} without a file`}
        </span>
      )}
      {line.review.map((entry) => (
        <span key={entry.id} className="flex flex-col gap-2">
          <s className="tabular-nums text-[var(--color-text-tertiary)]">{`${entryText(line.def, entry)}, ${formatDate(entry.date)}`}</s>
          <span className="body-caption text-[var(--st-wait)]">Stopped counting</span>
        </span>
      ))}
    </span>
  );
}

export function TotalText({ line, className }: { line: PrototypeLine; className?: string }) {
  if (line.state === "needsSetup") return <span className={cn(MUTED, className)}>Needs setup</span>;
  const empty = line.total == null && !(line.def.shape === "gas" && line.values.length) && line.state !== "nothingToRecord";
  if (line.def.shape === "gas" && line.values.length) {
    return <span className={cn("tabular-nums", className)}>{line.totalText.split(", ").map((part) => <span key={part} className="block whitespace-nowrap">{part}</span>)}</span>;
  }
  return <span className={cn("tabular-nums", empty && MUTED, className)}>{line.totalText}</span>;
}

/** Two blocks and an arrow. The after block is the live one. */
export function BeforeAfter({ before, after, className }: { before: string; after: string | null; className?: string }) {
  const block = "inline-flex min-h-32 items-center px-8 tabular-nums [border:var(--row-divider)] bg-[var(--color-background-white)]";
  if (after == null || after === before) return <span className={cn("tabular-nums", before === "Not recorded" && MUTED, className)}>{before}</span>;
  return (
    <span className={cn("inline-flex items-center gap-6 whitespace-nowrap", className)} aria-label={`Total ${before}, after save ${after}`}>
      <span className={cn(block, "text-[var(--color-text-secondary)]")}>{before}</span>
      <ArrowRightIcon size={14} weight="bold" aria-hidden="true" className="text-[var(--color-text-tertiary)]" />
      <span className={cn(block, "font-medium [border:1.5px_solid_var(--color-interaction)]")}>{after}</span>
    </span>
  );
}

/** The faint operator between two equation columns. */
export function Op({ children, className }: { children: string; className?: string }) {
  return <span aria-hidden="true" className={cn("select-none text-center body-small text-[var(--color-text-tertiary)]", className)}>{children}</span>;
}

/* ---------- panel state ---------- */

export type FormMode = "add" | "edit" | "again" | "nothing";
export type PanelView =
  | { lineId: string; view: "ledger"; description?: boolean }
  | { lineId: string; view: "form"; mode: FormMode; entryId?: string; from: "ledger" | "row" };

export interface LineOps {
  /** Add entry is offered on this line (the records-gap gate lives in the page file). */
  offered: (line: PrototypeLine) => boolean;
  markNothing: (line: PrototypeLine) => void;
  confirm: (line: PrototypeLine) => void;
  deleteEntry: (line: PrototypeLine, entry: PrototypeEntry) => void;
  openPanel: (next: PanelView) => void;
  closePanel: () => void;
}

export function LinePanel({ view, panel, ops }: { view: BatchView; panel: PanelView | null; ops: LineOps }) {
  const line = panel ? view.lines.find((l) => l.def.id === panel.lineId) : undefined;
  return (
    <SlideOverPanelRoot open={!!panel && !!line} onOpenChange={(next) => !next && ops.closePanel()}>
      <SlideOverPanelContent size="default">
        {panel && line && (panel.view === "ledger" ? (
          <Ledger key={`l-${line.def.id}`} line={line} batch={view.batch} ops={ops} descriptionOpen={!!panel.description} />
        ) : (
          <EntryForm key={`f-${line.def.id}-${panel.mode}-${panel.entryId ?? ""}`} line={line} batch={view.batch} panel={panel} ops={ops} />
        ))}
      </SlideOverPanelContent>
    </SlideOverPanelRoot>
  );
}

/* ---------- ledger view ---------- */

function LedgerRow({ label, figure, children, strong = false }: { label: string; figure?: ReactNode; children?: ReactNode; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-8 py-12">
      <div className="flex items-baseline justify-between gap-16">
        <span className={cn("body-small font-medium", !strong && "text-[var(--color-text-secondary)]")}>{label}</span>
        {figure != null && <span className={cn("text-right tabular-nums", strong ? "body-large font-medium" : "body-medium")}>{figure}</span>}
      </div>
      {children}
    </div>
  );
}

function LedgerOp({ children }: { children: string }) {
  return (
    <div aria-hidden="true" className="flex items-center gap-12">
      <span className="h-px flex-1 bg-[var(--color-border-tertiary)]" />
      <span className="body-medium text-[var(--color-text-tertiary)]">{children}</span>
      <span className="h-px w-[24px] bg-[var(--color-border-tertiary)]" />
    </div>
  );
}

function EntryMenu({ line, entry, ops }: { line: PrototypeLine; entry: PrototypeEntry; ops: LineOps }) {
  const nothing = entry.kind === "nothing";
  const items = [
    { label: nothing ? (entry.note ? "Edit note" : "Add note") : "Edit entry", run: () => ops.openPanel({ lineId: line.def.id, view: "form", mode: nothing ? "nothing" : "edit", entryId: entry.id, from: "ledger" }) },
    ...(!nothing && !entry.files.length ? [{ label: "Add file", run: () => ops.openPanel({ lineId: line.def.id, view: "form", mode: "edit" as const, entryId: entry.id, from: "ledger" }) }] : []),
    { label: nothing ? "Undo Nothing to record" : "Delete entry", run: () => ops.deleteEntry(line, entry), destructive: !nothing },
  ];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger render={<Button variant="noOutline" size="icon" aria-label={`Actions for the ${formatDate(entry.date)} entry`} className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]" />}>
        <DotsThreeVerticalIcon size={20} weight="bold" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        {items.map((item) => (
          <DropdownMenu.Item key={item.label} destructive={item.destructive} onClick={item.run}>{item.label}</DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

function EntryItem({ line, entry, ops }: { line: PrototypeLine; entry: PrototypeEntry; ops: LineOps }) {
  const nothing = entry.kind === "nothing";
  return (
    <li className="flex items-start gap-12 py-10 [border-top:var(--row-divider)] first:[border-top:none]">
      <span className="w-[96px] shrink-0 pt-2 body-caption text-[var(--color-text-tertiary)]">{formatDate(entry.date)}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="body-small font-medium tabular-nums">{nothing ? "Nothing to record" : entryText(line.def, entry)}</span>
        {!nothing && (
          <span className={cn("inline-flex items-center gap-4 body-caption", entry.files.length ? "text-[var(--color-text-secondary)]" : "text-[var(--st-wait)]")}>
            {entry.files.length ? <FileIcon size={12} aria-hidden="true" /> : <WarningIcon size={12} weight="bold" aria-hidden="true" />}
            {entry.files.length ? entry.files.join(", ") : "File missing"}
          </span>
        )}
        {entry.note ? (
          <span className="body-caption text-[var(--color-text-secondary)]">{entry.note}</span>
        ) : nothing && (
          <button type="button" onClick={() => ops.openPanel({ lineId: line.def.id, view: "form", mode: "nothing", entryId: entry.id, from: "ledger" })} className={cn(LINK, "self-start body-caption")}>
            Add note
          </button>
        )}
      </span>
      <EntryMenu line={line} entry={entry} ops={ops} />
    </li>
  );
}

function RecordsBlock({ line }: { line: PrototypeLine }) {
  const source = recordsSource(line);
  const parts = recordsParts(line);
  if (source.kind === "none") return <LedgerRow label="From records" figure={<span className={cn("body-small", MUTED)}>No records source</span>} />;
  const open = rowMenuItems(line).find((item) => item.key === "open");
  return (
    <LedgerRow label="From records" figure={parts.figure ?? <span className="body-small text-[var(--color-text-secondary)]">Not recorded</span>}>
      <div className="flex flex-wrap items-center justify-between gap-x-12 gap-y-4">
        <span className="body-small text-[var(--color-text-secondary)]">{parts.figure ? `From ${parts.source}. Read only here.` : `${parts.source}.`}</span>
        {open?.href && (
          <Link href={open.href} className={cn(LINK, "min-h-44 body-small font-medium")}>
            {open.label}
            <ArrowUpRightIcon size={14} weight="bold" aria-hidden="true" />
          </Link>
        )}
      </div>
    </LedgerRow>
  );
}

function Ledger({ line, batch, ops, descriptionOpen }: { line: PrototypeLine; batch: PrototypeBatch; ops: LineOps; descriptionOpen: boolean }) {
  const [showDescription, setShowDescription] = useState(descriptionOpen);
  const kind = lineCase(line);
  const { def } = line;
  const refusal = nothingToRecordRefusal(line);
  const open = rowMenuItems(line).find((item) => item.key === "open");
  const counting = [...line.values, ...(line.nothing && !line.values.length ? [line.nothing] : [])];
  const entriesFigure = line.values.length ? formatFigure(sumValues(line), def.unit) : line.nothing ? `0 ${def.unit}` : undefined;
  const addFirst = () => ops.openPanel({ lineId: def.id, view: "form", mode: "add", from: "ledger" });

  let body: ReactNode;
  if (line.state === "needsSetup") {
    body = <p className="body-small text-[var(--color-text-secondary)]">{SETUP_TEXT}</p>;
  } else if (kind === "S") {
    body = (
      <div className="flex flex-col gap-12">
        <p className="body-small text-[var(--color-text-secondary)]">One entry per credit batch. No records part, so no sum.</p>
        {line.values.length ? (
          <ul>{line.values.map((entry) => <EntryItem key={entry.id} line={line} entry={entry} ops={ops} />)}</ul>
        ) : (
          <p className={cn("body-small", MUTED)}>Not recorded</p>
        )}
        <p className="body-small">{`Dry feedstock in ${batch.code}: ${formatNumber(batch.dryFeedstockT)} t. Yearly report: ${YEARLY_REPORT_FILE}.`}</p>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col">
        <RecordsBlock line={line} />
        <LedgerOp>+</LedgerOp>
        <LedgerRow label="Entries" figure={kind === "R" ? undefined : entriesFigure ?? <span className={cn("body-small", MUTED)}>None</span>}>
          {kind === "R" ? (
            <p className={cn("body-small", MUTED)}>Takes no entries. This line is filled from applications.</p>
          ) : (
            <>
              {counting.length > 0 && <ul>{counting.map((entry) => <EntryItem key={entry.id} line={line} entry={entry} ops={ops} />)}</ul>}
              {line.review.length > 0 && (
                <div className="flex flex-col gap-8 p-12 [border:var(--row-divider)]">
                  <span className="body-caption font-medium text-[var(--st-wait)]">Stopped counting</span>
                  <ReviewBlock line={line} batch={batch} onEnterAgain={() => ops.openPanel({ lineId: def.id, view: "form", mode: "again", from: "ledger" })} />
                </div>
              )}
              {kind === "D" && <p className="body-caption text-[var(--color-text-tertiary)]">{`Add an entry only for what the ${line.records?.label ?? "records"} do not cover.`}</p>}
              {kind === "Z" && <p className="body-caption text-[var(--color-text-tertiary)]">{ISOMETRIC_ZERO}</p>}
            </>
          )}
        </LedgerRow>
        <LedgerOp>=</LedgerOp>
        <LedgerRow label="Total" strong figure={<TotalText line={line} />} />
      </div>
    );
  }

  const footer = (() => {
    if (line.state === "needsSetup") return <Button variant="weak" onClick={ops.closePanel}>Close</Button>;
    if (kind === "R") return open?.href ? <Link href={open.href} className={cn(LINK, "min-h-44 body-small font-medium")}>{open.label}</Link> : null;
    if (kind === "S") {
      return line.values.length ? (
        <Button variant="primary" onClick={() => ops.openPanel({ lineId: def.id, view: "form", mode: "edit", entryId: line.values[0].id, from: "ledger" })}>Edit entry</Button>
      ) : (
        <>
          <NothingLink line={line} refusal={refusal} ops={ops} />
          <Button variant="primary" onClick={addFirst}>Add entry</Button>
        </>
      );
    }
    return (
      <>
        {nothingApplies(line) && <NothingLink line={line} refusal={refusal} ops={ops} />}
        <span className="flex flex-wrap items-center justify-end gap-12">
          {hasRecordsGap(line) && open?.href && kind !== "F" && (
            <Link href={open.href} className={cn(LINK, "min-h-44 body-small font-medium")}>{open.label}</Link>
          )}
          {ops.offered(line) && <Button variant={kind === "B1" || kind === "B2" ? "weak" : "primary"} onClick={addFirst}>Add entry</Button>}
        </span>
      </>
    );
  })();

  return (
    <>
      <SlideOverPanelHeader>
        <SlideOverPanelTitle>{def.name}</SlideOverPanelTitle>
        <SlideOverPanelDescription>{`${def.group}, ${batch.code}`}</SlideOverPanelDescription>
      </SlideOverPanelHeader>
      <SlideOverPanelBody>
        <div className="flex flex-col gap-16">
          <div className="flex flex-wrap items-center gap-12">
            <LineStateBadge state={line.state} />
            <DisclosureButton open={showDescription} onToggle={() => setShowDescription((v) => !v)}>Line description</DisclosureButton>
          </div>
          {showDescription && <p className="body-small whitespace-pre-line text-[var(--color-text-secondary)]">{def.description}</p>}
          {body}
          {line.records && kind !== "R" && <ProtoNote>The records link opens the unfiltered page. The real link filters to the credit batch window.</ProtoNote>}
        </div>
      </SlideOverPanelBody>
      <SlideOverPanelFooter className="flex-wrap justify-between">{footer}</SlideOverPanelFooter>
    </>
  );
}

function NothingLink({ line, refusal, ops }: { line: PrototypeLine; refusal: string | null; ops: LineOps }) {
  if (refusal) {
    return (
      <span className="flex flex-col">
        <span className={cn("body-small", MUTED)}>Nothing to record</span>
        <span className="body-caption text-[var(--color-text-tertiary)]">{refusal}</span>
      </span>
    );
  }
  return (
    <button type="button" onClick={() => { ops.markNothing(line); ops.closePanel(); }} className={cn(LINK, "min-h-44 body-small")}>
      Nothing to record
    </button>
  );
}

/* ---------- entry form view ---------- */

interface FormValues {
  value: string; mass: string; distance: string; concentration: string; massFlow: string;
  date: string; note: string; files: DeferredFileEntry[]; existingFiles: string[];
}
type FormErrors = Partial<Record<keyof FormValues, string>>;

const FORM_TITLES: Record<FormMode, string> = { add: "Add entry", edit: "Edit entry", again: "Enter again", nothing: "Nothing to record" };

function SectionHead({ title, aside, op }: { title: string; aside?: string; op?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-12">
      <h3 className="inline-flex items-baseline gap-8 body-small font-medium">
        {op && <Op className="w-[12px] body-medium">{op}</Op>}
        {title}
      </h3>
      {aside && <span className="body-caption text-[var(--color-text-tertiary)]">{aside}</span>}
    </div>
  );
}

function EntryForm({ line, batch, panel, ops }: { line: PrototypeLine; batch: PrototypeBatch; panel: Extract<PanelView, { view: "form" }>; ops: LineOps }) {
  const toast = useToast();
  const { def } = line;
  const kind = lineCase(line);
  const nothing = panel.mode === "nothing";
  const editing = panel.entryId ? line.entries.find((e) => e.id === panel.entryId) : undefined;
  const again = panel.mode === "again" ? line.review[0] : undefined;
  const seed = editing ?? again;
  const [values, setValues] = useState<FormValues>({
    value: seed?.value?.toString() ?? "", mass: seed?.mass?.toString() ?? "", distance: seed?.distance?.toString() ?? "",
    concentration: seed?.concentration?.toString() ?? "", massFlow: seed?.massFlow?.toString() ?? "",
    date: seed?.date ?? defaultEntryDate(batch), note: seed?.note ?? "", files: [], existingFiles: editing?.files ?? [],
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [showDescription, setShowDescription] = useState(false);
  const set = (key: keyof FormValues) => (event: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: event.target.value }));
  const back = () => (panel.from === "ledger" ? ops.openPanel({ lineId: def.id, view: "ledger" }) : ops.closePanel());

  const mass = parseAmount(values.mass);
  const distance = parseAmount(values.distance);
  const product = mass != null && distance != null ? (mass * distance) / KG_PER_TONNE : null;

  const save = () => {
    const next: FormErrors = {};
    const need = (key: keyof FormValues) => { if (parseAmount(values[key] as string) == null) next[key] = MSG_NUMBER; };
    if (!nothing) {
      if (def.shape === "gas") { need("concentration"); need("massFlow"); }
      else if (def.shape === "massDistance") { need("mass"); need("distance"); }
      else need("value");
    }
    if (!values.date) next.date = "Enter a valid entry date.";
    else if (values.date < batch.startDate) next.date = "Entry date cannot be before the credit batch start date.";
    else if (values.date > TODAY) next.date = "Entry date cannot be in the future at this facility.";
    setErrors(next);
    if (Object.keys(next).length) return;
    const draft: EntryDraft = nothing
      ? { kind: "nothing", date: values.date, files: [], note: values.note.trim() }
      : {
          kind: "value", date: values.date, note: values.note.trim(),
          files: [...values.existingFiles, ...values.files.map((f) => f.file.name)],
          ...(def.shape === "gas" ? { concentration: Number(values.concentration), massFlow: Number(values.massFlow) }
            : def.shape === "massDistance" ? { mass: Number(values.mass), distance: Number(values.distance) }
            : { value: Number(values.value) }),
        };
    if (editing) prototypeActions.updateEntry(batch, editing.id, draft);
    else {
      const replace = again ? line.review.map((e) => e.id) : !nothing && line.nothing ? [line.nothing.id] : [];
      prototypeActions.addEntry(batch, def.id, draft, replace);
    }
    toast.success(nothing ? (editing ? `Note saved on ${def.name}.` : `${def.name} marked Nothing to record.`) : `Entry saved on ${def.name}.`);
    back();
  };

  const fields = nothing ? null : def.shape === "gas" ? (
    <div className="grid gap-16 sm:grid-cols-2">
      {GAS_INPUTS.map((input) => (
        <FormField key={input.key} id={`c3a-${input.key}`} label={input.label} unit={input.unit} error={errors[input.key]}>
          <Input id={`c3a-${input.key}`} inputMode="decimal" value={values[input.key]} onChange={set(input.key)} />
        </FormField>
      ))}
      <p className="body-caption text-[var(--color-text-secondary)] sm:col-span-2">
        {`Dry feedstock in ${batch.code}: ${formatNumber(batch.dryFeedstockT)} t. Mass flow = dry feedstock (t) × (36,792 t / 17,520 t).`}
      </p>
    </div>
  ) : def.shape === "massDistance" ? (
    <div className="grid items-start gap-16 sm:grid-cols-[1fr_1fr_auto]">
      <FormField id="c3a-mass" label="Mass" unit="kg" error={errors.mass}>
        <Input id="c3a-mass" inputMode="decimal" value={values.mass} onChange={set("mass")} autoFocus />
      </FormField>
      <FormField id="c3a-distance" label="Distance" unit="km" error={errors.distance}>
        <Input id="c3a-distance" inputMode="decimal" value={values.distance} onChange={set("distance")} />
      </FormField>
      <div className="flex flex-col gap-4 sm:pt-28">
        <span className="body-caption text-[var(--color-text-tertiary)]">Entry</span>
        <span className="body-medium font-medium tabular-nums">{product != null ? formatFigure(product, def.unit) : `0 ${def.unit}`}</span>
      </div>
    </div>
  ) : (
    <FormField id="c3a-value" label={def.inputLabel} unit={def.unit} error={errors.value}>
      <Input id="c3a-value" inputMode="decimal" value={values.value} onChange={set("value")} autoFocus />
    </FormField>
  );

  return (
    <>
      <SlideOverPanelHeader>
        <SlideOverPanelTitle>{FORM_TITLES[panel.mode]}</SlideOverPanelTitle>
        <SlideOverPanelDescription>{`${def.name}, ${def.group}`}</SlideOverPanelDescription>
      </SlideOverPanelHeader>
      <SlideOverPanelBody>
        <div className="flex flex-col gap-24">
          <div className="flex flex-col gap-8">
            <DisclosureButton open={showDescription} onToggle={() => setShowDescription((v) => !v)} className="self-start">Line description</DisclosureButton>
            {showDescription && <p className="body-small whitespace-pre-line text-[var(--color-text-secondary)]">{def.description}</p>}
          </div>

          {!nothing && line.nothing && !line.values.length && !editing && (
            <Notice tone="info">{`This replaces Nothing to record on ${def.name}.`}</Notice>
          )}
          {again && <p className="body-small text-[var(--color-text-secondary)]">{`Replaces ${entryText(def, again)} from ${formatDate(again.date)}, which stopped counting after a template change.`}</p>}

          <section className="flex flex-col gap-16">
            <SectionHead op={line.records && def.rule === "additive" && !nothing ? "+" : undefined} title={nothing ? "Nothing to record" : "Entry"} aside={nothing ? undefined : line.records ? "On top of records" : undefined} />
            {fields}
            <FormField id="c3a-date" label="Date" error={errors.date}>
              <Input id="c3a-date" type="date" value={values.date} min={batch.startDate} max={TODAY} onChange={set("date")} />
            </FormField>
            {!nothing && (
              <FormField id="c3a-file" label="File" certifyRequired hint={def.yearlyReport ? "The evidence for this line is the yearly emissions test report." : undefined}>
                <div className="flex flex-col gap-8">
                  {values.existingFiles.length > 0 && (
                    <ul className="flex flex-col gap-4">
                      {values.existingFiles.map((name) => <li key={name} className="inline-flex items-center gap-6 body-small"><FileIcon size={16} aria-hidden="true" />{name}</li>)}
                    </ul>
                  )}
                  <FormFileUpload
                    id="c3a-file"
                    deferred
                    deferredFiles={values.files}
                    onDeferredAdd={(files) => setValues((v) => ({ ...v, files: [...v.files, ...files.map((file) => ({ key: `${file.name}-${file.size}-${v.files.length}`, file }))] }))}
                    onDeferredRemove={(key) => setValues((v) => ({ ...v, files: v.files.filter((f) => f.key !== key) }))}
                  />
                  {def.yearlyReport && !values.existingFiles.includes(YEARLY_REPORT_FILE) && (
                    <div><Button size="small" variant="weak" onClick={() => setValues((v) => ({ ...v, existingFiles: [...v.existingFiles, YEARLY_REPORT_FILE] }))}>{`Use ${YEARLY_REPORT_FILE}`}</Button></div>
                  )}
                </div>
              </FormField>
            )}
            <FormField id="c3a-note" label="Note" cue={nothing ? "Optional. Say why, if it helps a reviewer." : undefined}>
              <FormTextarea id="c3a-note" value={values.note} onChange={set("note")} placeholder={nothing ? `For example: No staff flights in ${new Date(`${batch.startDate}T00:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" })}` : undefined} />
            </FormField>
            {nothing && <p className="body-caption text-[var(--color-text-tertiary)]">{ISOMETRIC_ZERO}</p>}
          </section>

          {kind === "S" && <p className="body-caption text-[var(--color-text-tertiary)]">One entry per credit batch, so there is no sum.</p>}
        </div>
      </SlideOverPanelBody>
      <SlideOverPanelFooter className="justify-between">
        <Button variant="weak" onClick={back}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save}>{nothing ? (editing ? "Save note" : "Mark nothing to record") : "Save entry"}</Button>
      </SlideOverPanelFooter>
    </>
  );
}
