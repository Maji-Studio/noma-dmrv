/**
 * PROTOTYPE C3c helpers: the source chips and the ledger drawer.
 *
 * Chips use three looks, one per meaning, and nothing else:
 *   wash (sea fill)        records made on another page; a link upstream
 *   dashed warning outline the records source exists but holds nothing
 *   plain outline          entries typed on this page
 * plus a quiet "Nothing to record" chip with no border.
 *
 * The drawer tells a line as a ledger: From records + Entries = Total, with
 * the operators in a left gutter. Add entry swaps the ledger for the form in
 * the same drawer while the records block stays pinned at the top.
 *
 * Entries cannot be deleted through prototypeActions, so this file keeps a
 * small module store of hidden entry ids (Delete and Undo). The page
 * re-derives its lines without them (useC3cData).
 */
"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import type { Icon } from "@phosphor-icons/react";
import {
  ArrowUpRightIcon,
  DotsThreeVerticalIcon,
  FileIcon,
  GearSixIcon,
  MinusCircleIcon,
  PencilSimpleIcon,
  PlantIcon,
  TruckIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { FormField, FormFileUpload, FormTextarea, type DeferredFileEntry } from "@/components/forms";
import { Button, DropdownMenu, Input, Notice } from "@/components/ui";
import {
  SlideOverPanelBody,
  SlideOverPanelContent,
  SlideOverPanelDescription,
  SlideOverPanelFooter,
  SlideOverPanelHeader,
  SlideOverPanelRoot,
  SlideOverPanelTitle,
} from "@/components/ui/slide-over-panel";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import {
  GAS_INPUTS,
  deriveLines,
  entriesFor,
  entryAmount,
  entryText,
  formatFigure,
  formatNumber,
  openLines,
  prototypeActions,
  type EntryDraft,
  type PrototypeBatch,
  type PrototypeEntry,
  type PrototypeLine,
  type RecordsLabel,
} from "./prototype-emissions-data";
import { DisclosureButton, LineStateBadge, YEARLY_REPORT_FILE, type usePrototypeEmissions } from "./prototype-emissions-shared";
import { compositionCaption, entriesText, lineCase, nothingToRecordRefusal, recordsSource, recordsText } from "./prototype-line-sources";

type Data = ReturnType<typeof usePrototypeEmissions>;
const KG_PER_TONNE = 1000;
const TODAY = new Date().toISOString().slice(0, 10);
const MSG_NUMBER = "Enter a non-negative decimal value.";
const ISOMETRIC_ZERO = "Sent to Isometric as 0 for this line, with no file. The note stays in noma.";
const SETUP_COPY = "noma cannot fill this template line yet. An admin sets it up in the template review.";

/* ---------- hidden entries (Delete and Undo) ---------- */

let hidden: ReadonlySet<string> = new Set();
const hiddenListeners = new Set<() => void>();
function setHidden(next: ReadonlySet<string>) {
  hidden = next;
  for (const listener of hiddenListeners) listener();
}
export const hiddenEntries = {
  hide: (id: string) => setHidden(new Set([...hidden, id])),
  show: (id: string) => setHidden(new Set([...hidden].filter((x) => x !== id))),
};
function useHidden(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => { hiddenListeners.add(listener); return () => hiddenListeners.delete(listener); },
    () => hidden,
    () => hidden,
  );
}

/** The page data with deleted entries left out of every derived line. */
export function useC3cData(data: Data): Data {
  const gone = useHidden();
  if (gone.size === 0) return data;
  const batches = data.batches.map((view) => {
    const lines = deriveLines(view.batch, entriesFor(data.store, view.batch).filter((entry) => !gone.has(entry.id)));
    return { ...view, lines, open: openLines(lines) };
  });
  return { ...data, batches };
}

/* ---------- vocabulary ---------- */

const ORIGIN_ICON: Record<RecordsLabel, Icon> = {
  "production runs": GearSixIcon,
  "transport legs": TruckIcon,
  deliveries: TruckIcon,
  applications: PlantIcon,
};
const SHORT_NOUN: Record<RecordsLabel, [string, string]> = {
  "production runs": ["run", "runs"],
  "transport legs": ["leg", "legs"],
  deliveries: ["delivery", "deliveries"],
  applications: ["application", "applications"],
};
const OPEN_LABEL: Record<RecordsLabel, string> = {
  "production runs": "Open production runs",
  "transport legs": "Open transport legs",
  deliveries: "Open deliveries",
  applications: "Open applications",
};
const FULL_NOUN: Record<RecordsLabel, [string, string]> = {
  "production runs": ["production run", "production runs"],
  "transport legs": ["transport leg", "transport legs"],
  deliveries: ["delivery", "deliveries"],
  applications: ["application", "applications"],
};
const count = (n: number, [one, many]: [string, string]) => `${formatNumber(n, 0)} ${n === 1 ? one : many}`;
const entriesWord = (n: number) => count(n, ["entry", "entries"]);
const sumOf = (line: PrototypeLine, entries: PrototypeEntry[]) => entries.reduce((sum, e) => sum + entryAmount(line.def, e), 0);

export function openUpstreamLabel(line: PrototypeLine): string | null {
  return line.records ? OPEN_LABEL[line.records.label] : null;
}
/** True when the line has a records source with nothing recorded on it. */
export function hasRecordsGap(line: PrototypeLine): boolean {
  return !!line.records && line.records.value == null;
}
/** Nothing to record applies to this line at all (allowed or refused). */
export function nothingApplies(line: PrototypeLine): boolean {
  return line.state !== "needsSetup" && line.def.rule !== "none" && lineCase(line) !== "Z";
}
export function defaultEntryDate(batch: PrototypeBatch): string {
  return batch.endDate < TODAY ? batch.endDate : TODAY;
}

/* ---------- chips ---------- */

const CHIP = "inline-flex min-h-28 items-center gap-6 whitespace-nowrap px-8 body-caption";
const PLUS = <span aria-hidden="true" className="body-caption text-[var(--color-text-tertiary)]">+</span>;

function recordsChipText(line: PrototypeLine): string {
  const source = recordsSource(line);
  if (source.kind === "none") return "";
  const noun = SHORT_NOUN[source.label];
  if (source.value != null) return count(source.count, noun);
  if (source.count > 0) return `None on ${count(source.count, noun)}`;
  return `No ${source.label} yet`;
}

/**
 * The Sources cell. `onEntries` makes the entries chip open the drawer at the
 * entries; `interactive={false}` (the bulk grid) renders every chip read-only.
 */
export function SourceChips({ line, onEntries, interactive = true, quiet = true }: { line: PrototypeLine; onEntries?: () => void; interactive?: boolean; quiet?: boolean }) {
  const { def } = line;
  const kind = lineCase(line);
  if (line.state === "needsSetup") return <span className="body-caption text-[var(--color-text-tertiary)]">Needs setup</span>;
  const chips: ReactNode[] = [];
  const source = recordsSource(line);
  if (source.kind === "records") {
    const OriginIcon = ORIGIN_ICON[source.label];
    const gap = source.value == null;
    const label = recordsChipText(line);
    const look = gap
      ? "border border-dashed border-[var(--st-wait-border)] text-[var(--st-wait)]"
      : "border border-transparent bg-[var(--sea)] text-[var(--color-text-primary)]";
    const inner = (
      <>
        <OriginIcon size={14} aria-hidden="true" />
        {label}
        {interactive && <ArrowUpRightIcon size={12} weight="bold" aria-hidden="true" className="text-[var(--color-text-tertiary)]" />}
      </>
    );
    chips.push(
      interactive ? (
        <Link
          key="records"
          href={source.href}
          onClick={(event) => event.stopPropagation()}
          title={recordsText(line)}
          aria-label={`${recordsText(line)}. ${OPEN_LABEL[source.label]}`}
          className={cn(CHIP, look, "hover:border-[var(--color-border-primary)]")}
        >
          {inner}
        </Link>
      ) : (
        <span key="records" title={recordsText(line)} className={cn(CHIP, look)}>{inner}</span>
      ),
    );
  }
  const entryChips: ReactNode[] = [];
  if (line.values.length) {
    const missing = line.values.some((e) => !e.files.length);
    const yearly = def.yearlyReport && line.values[0].files.includes(YEARLY_REPORT_FILE);
    const label = `${entriesWord(line.values.length)}${yearly ? ", yearly report" : ""}`;
    entryChips.push(
      <EntryChip key="entries" interactive={interactive} onClick={onEntries} label={missing ? `${label}, file missing` : label}>
        {missing ? <WarningIcon size={14} weight="bold" aria-hidden="true" className="text-[var(--st-wait)]" /> : <PencilSimpleIcon size={14} aria-hidden="true" />}
        {label}
      </EntryChip>,
    );
  }
  if (line.review.length) {
    entryChips.push(
      <EntryChip key="review" interactive={interactive} onClick={onEntries} label={`${entriesWord(line.review.length)}, stopped counting`} dim>
        <PencilSimpleIcon size={14} aria-hidden="true" />
        <span className="line-through">{entriesWord(line.review.length)}</span>
        <span>stopped</span>
      </EntryChip>,
    );
  }
  if (kind === "Z") {
    entryChips.push(
      <span key="nothing" className={cn(CHIP, "px-0 text-[var(--color-text-secondary)]")}>
        <MinusCircleIcon size={14} aria-hidden="true" />
        {entriesText(line)}
      </span>,
    );
  }
  if (chips.length && entryChips.length) chips.push(<span key="plus">{PLUS}</span>);
  chips.push(...entryChips);
  if (!chips.length) {
    if (!quiet) return null;
    const quietText = kind === "S" ? "One entry per credit batch" : "No records source";
    return <span className="body-caption text-[var(--color-text-tertiary)]">{quietText}</span>;
  }
  return <span className="flex flex-wrap items-center gap-x-6 gap-y-4">{chips}</span>;
}

function EntryChip({ children, label, interactive, onClick, dim }: { children: ReactNode; label: string; interactive: boolean; onClick?: () => void; dim?: boolean }) {
  const look = cn(CHIP, "border border-[var(--color-border-tertiary)] bg-[var(--color-background-white)]", dim && "text-[var(--color-text-tertiary)]");
  if (!interactive || !onClick) return <span className={look} aria-label={label}>{children}</span>;
  return (
    <button type="button" aria-label={`${label}. Show entries`} onClick={(event) => { event.stopPropagation(); onClick(); }} className={cn(look, "hover:border-[var(--color-border-primary)]")}>
      {children}
    </button>
  );
}

/* ---------- drawer ---------- */

export type DrawerMode =
  | { view: "ledger"; focus?: "entries" | "note" }
  | { view: "form"; mode: "add" | "edit" | "again"; entryId?: string };

interface LedgerDrawerProps {
  batch: PrototypeBatch;
  line: PrototypeLine | null;
  mode: DrawerMode;
  setMode: (mode: DrawerMode) => void;
  onClose: () => void;
  /** Whether Add entry is offered on this line (OFFER_ENTRY_ON_RECORDS_GAP). */
  canAdd: boolean;
  onNothing: (line: PrototypeLine) => void;
  onDelete: (line: PrototypeLine, entry: PrototypeEntry) => void;
}

export function LedgerDrawer({ batch, line, mode, setMode, onClose, canAdd, onNothing, onDelete }: LedgerDrawerProps) {
  return (
    <SlideOverPanelRoot open={!!line} onOpenChange={(next) => !next && onClose()}>
      <SlideOverPanelContent size="default">
        {line && (mode.view === "form" ? (
          <EntryForm key={`${line.def.id}-${mode.mode}-${mode.entryId ?? ""}`} batch={batch} line={line} mode={mode} onBack={() => setMode({ view: "ledger" })} />
        ) : (
          <LedgerView batch={batch} line={line} focus={mode.focus} canAdd={canAdd} setMode={setMode} onNothing={onNothing} onDelete={onDelete} />
        ))}
      </SlideOverPanelContent>
    </SlideOverPanelRoot>
  );
}

/* ---------- the ledger ---------- */

/** One ledger row: operator in the gutter, label and detail, figure on the right. */
function LedgerRow({ op, label, figure, children, total, muted }: { op?: string; label: string; figure?: ReactNode; children?: ReactNode; total?: boolean; muted?: boolean }) {
  return (
    <div className={cn("grid grid-cols-[28px_minmax(0,1fr)] gap-x-8", total && "[border-top:var(--hair)] pt-12")}>
      <span aria-hidden="true" className="title-heading-4 leading-none text-[var(--color-text-tertiary)]">{op}</span>
      <div className="flex min-w-0 flex-col gap-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-16">
          <span className={cn("body-small font-medium", muted && "text-[var(--color-text-secondary)]")}>{label}</span>
          {figure != null && <span className={cn("tabular-nums text-right", total ? "title-heading-4" : "body-small font-medium", muted && "text-[var(--color-text-tertiary)]")}>{figure}</span>}
        </div>
        {children}
      </div>
    </div>
  );
}

function RecordsDetail({ line, pinned }: { line: PrototypeLine; pinned?: boolean }) {
  const source = recordsSource(line);
  if (source.kind === "none") return <span className="body-caption text-[var(--color-text-tertiary)]">No records source. Nothing upstream feeds this line.</span>;
  const OriginIcon = ORIGIN_ICON[source.label];
  const gap = source.value == null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-12 gap-y-4">
      <span className={cn("inline-flex items-center gap-6 body-small", gap ? "text-[var(--st-wait)]" : "text-[var(--color-text-secondary)]")}>
        <OriginIcon size={16} aria-hidden="true" />
        {gap ? recordsText(line) : count(source.count, FULL_NOUN[source.label])}
      </span>
      <Link href={source.href} className={cn("inline-flex items-center gap-4 body-small font-medium text-[var(--color-text-interaction-primary)] underline underline-offset-4", pinned ? "min-h-24" : "min-h-44")}>
        {OPEN_LABEL[source.label]}
        <ArrowUpRightIcon size={14} weight="bold" aria-hidden="true" />
      </Link>
    </div>
  );
}

interface LedgerViewProps {
  batch: PrototypeBatch;
  line: PrototypeLine;
  focus?: "entries" | "note";
  canAdd: boolean;
  setMode: (mode: DrawerMode) => void;
  onNothing: (line: PrototypeLine) => void;
  onDelete: (line: PrototypeLine, entry: PrototypeEntry) => void;
}

function LedgerView({ batch, line, focus, canAdd, setMode, onNothing, onDelete }: LedgerViewProps) {
  const toast = useToast();
  const { def } = line;
  const kind = lineCase(line);
  const [showDescription, setShowDescription] = useState(false);
  const refusal = nothingToRecordRefusal(line);
  const single = kind === "S";
  // A records gap names itself in the detail line, so it carries no figure.
  const recordsFigure = line.auto ? formatFigure(line.auto.value, def.unit) : undefined;
  const entriesFigure = line.values.length ? formatFigure(sumOf(line, line.values), def.unit) : kind === "Z" ? `0 ${def.unit}` : "None";
  const total = line.state === "needsReview" && !line.values.length ? "Not recorded" : line.totalText;
  const edit = (entry: PrototypeEntry) => setMode({ view: "form", mode: "edit", entryId: entry.id });

  const entryList = (
    <ul id="c3c-entries" className={cn("flex flex-col", focus === "entries" && "outline-none")}>
      {line.values.map((entry) => (
        <EntryItem key={entry.id} line={line} entry={entry} onEdit={() => edit(entry)} onDelete={() => onDelete(line, entry)} />
      ))}
      {line.review.map((entry) => (
        <li key={entry.id} className="flex flex-col gap-8 [border-top:var(--row-divider)] py-10 first:[border-top:none] first:pt-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-12 text-[var(--color-text-tertiary)]">
            <span className="body-small">{formatDate(entry.date)}</span>
            <span className="body-small tabular-nums line-through">{entryText(def, entry)}</span>
          </div>
          <span className="body-caption text-[var(--st-wait)]">Stopped counting after a template change. It is not in the total until you confirm it.</span>
          <div className="flex flex-wrap gap-8">
            <Button size="small" variant="primary" onClick={() => { prototypeActions.confirm(batch, def.id); toast.success(`${def.name} confirmed.`); }}>Confirm</Button>
            <Button size="small" variant="weak" onClick={() => setMode({ view: "form", mode: "again" })}>Enter again</Button>
          </div>
        </li>
      ))}
      {line.nothing && !line.values.length && <NothingItem batch={batch} line={line} entry={line.nothing} startEditing={focus === "note"} onUndo={() => onDelete(line, line.nothing!)} />}
      {!line.values.length && !line.review.length && !line.nothing && (
        <li className="body-caption text-[var(--color-text-tertiary)]">No entries yet.</li>
      )}
    </ul>
  );

  let ledger: ReactNode;
  if (line.state === "needsSetup") {
    ledger = <Notice tone="info">{SETUP_COPY}</Notice>;
  } else if (single) {
    ledger = (
      <div className="flex flex-col gap-16">
        <LedgerRow label="Entry" figure={line.values.length ? undefined : "Not recorded"} muted={!line.values.length}>
          <span className="body-caption text-[var(--color-text-tertiary)]">One entry per credit batch. Its evidence is the yearly emissions test report.</span>
          {entryList}
        </LedgerRow>
        <p className="body-small">{`Dry feedstock in ${batch.code}: ${formatNumber(batch.dryFeedstockT)} t`}</p>
      </div>
    );
  } else {
    ledger = (
      <div className="flex flex-col gap-16" aria-label={`${def.name}: ${compositionCaption(line)}`}>
        <LedgerRow label="From records" figure={recordsFigure} muted={!line.auto}>
          <RecordsDetail line={line} />
        </LedgerRow>
        <LedgerRow op="+" label="Entries" figure={def.rule === "none" ? undefined : entriesFigure} muted={!line.values.length}>
          {def.rule === "none" ? <span className="body-caption text-[var(--color-text-tertiary)]">Takes no entries. This line is filled from applications and lab results.</span> : entryList}
        </LedgerRow>
        <LedgerRow op="=" label="Total" figure={total} total muted={line.total == null && kind !== "Z"} />
        {kind === "D" && canAdd && <p className="body-caption text-[var(--color-text-tertiary)]">{`Add an entry only for what the ${line.records?.label} do not cover.`}</p>}
        {kind === "F" && <p className="body-caption text-[var(--st-wait)]">{`The entries stand on their own: ${recordsText(line).toLowerCase()}.`}</p>}
      </div>
    );
  }

  const singleEntry = single ? line.values[0] : undefined;
  const source = recordsSource(line);
  const upstream = source.kind === "records" ? source : null;
  return (
    <>
      <SlideOverPanelHeader>
        <SlideOverPanelTitle>{def.name}</SlideOverPanelTitle>
        <SlideOverPanelDescription>{`${def.group}, ${batch.code}`}</SlideOverPanelDescription>
      </SlideOverPanelHeader>
      <SlideOverPanelBody>
        <div className="flex flex-col gap-20">
          <div className="flex flex-wrap items-center justify-between gap-12">
            <LineStateBadge state={line.state} />
            <DisclosureButton open={showDescription} onToggle={() => setShowDescription((v) => !v)}>Line description</DisclosureButton>
          </div>
          {showDescription && <p className="body-small whitespace-pre-line text-[var(--color-text-secondary)]">{def.description}</p>}
          {ledger}
        </div>
      </SlideOverPanelBody>
      {line.state !== "needsSetup" && (
        <SlideOverPanelFooter className="flex-wrap justify-between">
          <div className="flex min-w-0 flex-1 flex-col items-start">
            {nothingApplies(line) && (
              refusal ? (
                <span className="body-caption text-[var(--color-text-tertiary)]">{`Nothing to record is off. ${refusal}.`}</span>
              ) : (
                <button type="button" onClick={() => onNothing(line)} className="inline-flex min-h-44 items-center gap-6 body-small font-medium text-[var(--color-text-interaction-primary)] underline underline-offset-4">
                  <MinusCircleIcon size={16} aria-hidden="true" />
                  Nothing to record
                </button>
              )
            )}
          </div>
          {upstream && def.rule === "none" ? (
            <Link href={upstream.href} className="inline-flex h-[40px] items-center gap-8 border border-[var(--color-border-primary)] px-16 label-button hover:bg-[var(--color-surface-medium)]">
              {OPEN_LABEL[upstream.label]}
            </Link>
          ) : singleEntry ? (
            <Button variant="primary" onClick={() => edit(singleEntry)}>Edit entry</Button>
          ) : canAdd ? (
            <Button variant="primary" onClick={() => setMode({ view: "form", mode: "add" })}>Add entry</Button>
          ) : null}
        </SlideOverPanelFooter>
      )}
    </>
  );
}

function EntryMenu({ label, items }: { label: string; items: { label: string; onSelect: () => void; destructive?: boolean }[] }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger render={<Button variant="noOutline" size="icon" aria-label={label} className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]" />}>
        <DotsThreeVerticalIcon size={20} weight="bold" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        {items.map((item) => (
          <DropdownMenu.Item key={item.label} destructive={item.destructive} onClick={item.onSelect}>{item.label}</DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

function EntryItem({ line, entry, onEdit, onDelete }: { line: PrototypeLine; entry: PrototypeEntry; onEdit: () => void; onDelete: () => void }) {
  const missing = !entry.files.length;
  const items = [
    { label: "Edit entry", onSelect: onEdit },
    ...(missing ? [{ label: "Add file", onSelect: onEdit }] : []),
    { label: "Delete entry", onSelect: onDelete, destructive: true },
  ];
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-8 [border-top:var(--row-divider)] py-10 first:[border-top:none] first:pt-0">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-12">
          <span className="body-small text-[var(--color-text-secondary)]">{formatDate(entry.date)}</span>
          <span className="body-small font-medium tabular-nums">{entryText(line.def, entry)}</span>
        </div>
        {missing ? (
          <span className="flex flex-wrap items-center gap-x-12">
            <span className="inline-flex items-center gap-4 body-caption text-[var(--st-wait)]"><WarningIcon size={14} weight="bold" aria-hidden="true" />File missing</span>
            <Button size="small" variant="weak" onClick={onEdit}>Add file</Button>
          </span>
        ) : (
          <span className="inline-flex min-w-0 items-center gap-4 body-caption text-[var(--color-text-secondary)]"><FileIcon size={14} aria-hidden="true" /><span className="truncate">{entry.files.join(", ")}</span></span>
        )}
        {entry.note && <span className="body-caption text-[var(--color-text-secondary)]">{entry.note}</span>}
      </div>
      <EntryMenu label={`Actions for the ${formatDate(entry.date)} entry`} items={items} />
    </li>
  );
}

function NothingItem({ batch, line, entry, startEditing, onUndo }: { batch: PrototypeBatch; line: PrototypeLine; entry: PrototypeEntry; startEditing: boolean; onUndo: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(startEditing);
  const [note, setNote] = useState(entry.note);
  const saveNote = () => {
    prototypeActions.updateEntry(batch, entry.id, { kind: "nothing", date: entry.date, files: [], note: note.trim() });
    toast.success(`Note saved on ${line.def.name}.`);
    setEditing(false);
  };
  return (
    <li className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-x-12">
        <span className="inline-flex items-center gap-6 body-small font-medium"><MinusCircleIcon size={16} aria-hidden="true" />Nothing to record</span>
        <span className="body-small text-[var(--color-text-secondary)]">{`Marked for ${formatDate(entry.date)}`}</span>
      </div>
      {editing ? (
        <div className="flex flex-col gap-8">
          <FormField id="c3c-zero-note" label="Note">
            <FormTextarea id="c3c-zero-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: No diesel burners started this month" autoFocus />
          </FormField>
          <div className="flex gap-8">
            <Button size="small" variant="primary" onClick={saveNote}>Save note</Button>
            <Button size="small" variant="weak" onClick={() => { setNote(entry.note); setEditing(false); }}>Cancel</Button>
          </div>
        </div>
      ) : entry.note ? (
        <p className="body-small text-[var(--color-text-secondary)]">
          {entry.note}{" "}
          <button type="button" onClick={() => setEditing(true)} className="inline-flex min-h-24 items-center body-small text-[var(--color-text-interaction-primary)] underline underline-offset-4">Edit note</button>
        </p>
      ) : (
        <div>
          <Button size="small" variant="weak" onClick={() => setEditing(true)}>Add note</Button>
        </div>
      )}
      <p className="body-caption text-[var(--color-text-tertiary)]">{ISOMETRIC_ZERO}</p>
      <div>
        <button type="button" onClick={onUndo} className="inline-flex min-h-44 items-center body-small text-[var(--color-text-interaction-primary)] underline underline-offset-4">Undo nothing to record</button>
      </div>
    </li>
  );
}

/* ---------- the add form (replaces the ledger in the drawer) ---------- */

interface FormValues {
  value: string; mass: string; distance: string; concentration: string; massFlow: string;
  date: string; note: string; files: DeferredFileEntry[]; existingFiles: string[];
}
type FormErrors = Partial<Record<keyof FormValues, string>>;
const parseAmount = (raw: string): number | null => (/^\d+(?:\.\d+)?$/.test(raw.trim()) ? Number(raw) : null);
const FORM_TITLES = { add: "Add entry", edit: "Edit entry", again: "Enter again" } as const;

function EntryForm({ batch, line, mode, onBack }: { batch: PrototypeBatch; line: PrototypeLine; mode: Extract<DrawerMode, { view: "form" }>; onBack: () => void }) {
  const toast = useToast();
  const { def } = line;
  const editing = mode.mode === "edit" ? line.values.find((e) => e.id === mode.entryId) : undefined;
  const again = mode.mode === "again" ? line.review[0] : undefined;
  const seed = editing ?? again;
  const [values, setValues] = useState<FormValues>({
    value: seed?.value?.toString() ?? "", mass: seed?.mass?.toString() ?? "", distance: seed?.distance?.toString() ?? "",
    concentration: seed?.concentration?.toString() ?? "", massFlow: seed?.massFlow?.toString() ?? "",
    date: seed?.date ?? defaultEntryDate(batch), note: seed?.note ?? "", files: [], existingFiles: editing?.files ?? [],
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const set = (key: keyof FormValues) => (event: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: event.target.value }));

  const gas = def.shape === "gas";
  const replacesZero = !!line.nothing && !editing;
  const mass = parseAmount(values.mass);
  const distance = parseAmount(values.distance);
  const draftFigure = def.shape === "massDistance" ? (mass != null && distance != null ? (mass * distance) / KG_PER_TONNE : null) : gas ? null : parseAmount(values.value);

  const save = () => {
    const next: FormErrors = {};
    const need = (key: keyof FormValues) => { if (parseAmount(values[key] as string) == null) next[key] = MSG_NUMBER; };
    if (gas) { need("concentration"); need("massFlow"); }
    else if (def.shape === "massDistance") { need("mass"); need("distance"); }
    else need("value");
    if (!values.date) next.date = "Enter a valid entry date.";
    else if (values.date < batch.startDate) next.date = "Entry date cannot be before the credit batch start date.";
    else if (values.date > TODAY) next.date = "Entry date cannot be in the future at this facility.";
    setErrors(next);
    if (Object.keys(next).length) return;
    const draft: EntryDraft = {
      kind: "value", date: values.date, note: values.note.trim(),
      files: [...values.existingFiles, ...values.files.map((f) => f.file.name)],
      ...(gas ? { concentration: Number(values.concentration), massFlow: Number(values.massFlow) }
        : def.shape === "massDistance" ? { mass: Number(values.mass), distance: Number(values.distance) }
        : { value: Number(values.value) }),
    };
    if (editing) prototypeActions.updateEntry(batch, editing.id, draft);
    else {
      const replace = [...(again ? line.review.map((e) => e.id) : []), ...(replacesZero && line.nothing ? [line.nothing.id] : [])];
      prototypeActions.addEntry(batch, def.id, draft, replace);
    }
    toast.success(`Entry saved on ${def.name}.`);
    onBack();
  };

  return (
    <>
      <SlideOverPanelHeader>
        <SlideOverPanelTitle>{FORM_TITLES[mode.mode]}</SlideOverPanelTitle>
        <SlideOverPanelDescription>{`${def.name}, ${batch.code}`}</SlideOverPanelDescription>
      </SlideOverPanelHeader>
      <SlideOverPanelBody>
        <div className="flex flex-col gap-20">
          {replacesZero && <Notice tone="warning">{`This replaces Nothing to record on ${def.name}.`}</Notice>}
          {again && <p className="body-small text-[var(--color-text-secondary)]">{`Replaces ${entryText(def, again)} from ${formatDate(again.date)}, which stopped counting after a template change.`}</p>}
          {gas ? (
            <>
              {GAS_INPUTS.map((input) => (
                <FormField key={input.key} id={`c3c-${input.key}`} label={input.label} unit={input.unit} error={errors[input.key]}>
                  <Input id={`c3c-${input.key}`} inputMode="decimal" value={values[input.key]} onChange={set(input.key)} />
                </FormField>
              ))}
              <p className="body-small">{`Dry feedstock in ${batch.code}: ${formatNumber(batch.dryFeedstockT)} t`}</p>
              <p className="body-caption whitespace-pre-line text-[var(--color-text-secondary)]">{def.description}</p>
            </>
          ) : def.shape === "massDistance" ? (
            <div className="grid grid-cols-1 gap-16 sm:grid-cols-2">
              <FormField id="c3c-mass" label="Mass" unit="kg" error={errors.mass}>
                <Input id="c3c-mass" inputMode="decimal" value={values.mass} onChange={set("mass")} autoFocus />
              </FormField>
              <FormField id="c3c-distance" label="Distance" unit="km" error={errors.distance} cue={draftFigure != null ? `This entry: ${formatFigure(draftFigure, def.unit)}` : undefined}>
                <Input id="c3c-distance" inputMode="decimal" value={values.distance} onChange={set("distance")} />
              </FormField>
            </div>
          ) : (
            <FormField id="c3c-value" label={def.inputLabel} unit={def.unit} error={errors.value}>
              <Input id="c3c-value" inputMode="decimal" value={values.value} onChange={set("value")} autoFocus />
            </FormField>
          )}
          <FormField id="c3c-date" label="Date" error={errors.date}>
            <Input id="c3c-date" type="date" value={values.date} min={batch.startDate} max={TODAY} onChange={set("date")} />
          </FormField>
          <FormField id="c3c-file" label="File" certifyRequired>
            <div className="flex flex-col gap-8">
              {values.existingFiles.length > 0 && (
                <ul className="flex flex-col gap-4">
                  {values.existingFiles.map((name) => <li key={name} className="inline-flex items-center gap-6 body-small"><FileIcon size={16} aria-hidden="true" />{name}</li>)}
                </ul>
              )}
              <FormFileUpload
                id="c3c-file"
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
          <FormField id="c3c-note" label="Note">
            <FormTextarea id="c3c-note" value={values.note} onChange={set("note")} />
          </FormField>
        </div>
      </SlideOverPanelBody>
      <SlideOverPanelFooter>
        <Button variant="weak" onClick={onBack}>Cancel</Button>
        <Button variant="primary" onClick={save}>Save entry</Button>
      </SlideOverPanelFooter>
    </>
  );
}
