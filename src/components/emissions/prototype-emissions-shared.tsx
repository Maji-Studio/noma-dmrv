/**
 * PROTOTYPE (epic #1058 PR 3). Pieces every Emissions variant shares: the
 * data hook, state badge, line details, the next action, the entry sheet,
 * facility activity totals and the batch sheet panel. Layout stays in each
 * variant file.
 */
"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CaretDownIcon, CaretRightIcon, FileIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField, FormFileUpload, FormTextarea, type DeferredFileEntry } from "@/components/forms";
import { Button, Input, StatusBadge, type StatusValue } from "@/components/ui";
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
import { useCreditBatches } from "@/hooks/use-credit-batches";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { formatDate, formatDateRange } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { useLedgerHref } from "./prototype-ledger-query";
import {
  GAS_INPUTS,
  PROTOTYPE_STATE_LABELS,
  activityTotals,
  deriveLines,
  entriesFor,
  entryAmount,
  entryText,
  formatFigure,
  formatNumber,
  openLines,
  prototypeActions,
  prototypeBatches,
  usePrototypeStore,
  type EntryDraft,
  type PrototypeBatch,
  type PrototypeLine,
  type PrototypeLineState,
} from "./prototype-emissions-data";

export const YEARLY_REPORT_FILE = "emissions-test-report-2026.pdf";
const KG_PER_TONNE = 1000;
const TODAY = new Date().toISOString().slice(0, 10);

/* ---------- data ---------- */

export interface BatchView {
  batch: PrototypeBatch;
  lines: PrototypeLine[];
  open: PrototypeLine[];
}

export function usePrototypeEmissions() {
  const { facilityId, selectedFacility } = useFacilityContext();
  const { data: real = [], isLoading } = useCreditBatches(facilityId ?? undefined);
  const store = usePrototypeStore();
  const batches: BatchView[] = prototypeBatches(real).map((batch) => {
    const lines = deriveLines(batch, entriesFor(store, batch));
    return { batch, lines, open: openLines(lines) };
  });
  return { facilityId, facilityName: selectedFacility?.name ?? null, isLoading, batches, store };
}

/** Links keep `?variant=`, `?facility=` and the overview filter and sort (prototype-ledger-query.ts). */
export const useEmissionsHref = useLedgerHref;

export function batchPeriod(batch: PrototypeBatch): string {
  return formatDateRange(batch.startDate, batch.endDate);
}

/* ---------- small pieces ---------- */

const STATE_BADGE: Record<PrototypeLineState, StatusValue> = {
  filled: "complete",
  nothingToRecord: "complete",
  confirmedZero: "complete",
  empty: "draft",
  missingEvidence: "pending",
  needsReview: "pending",
  needsSetup: "failed",
};
export function LineStateBadge({ state, className }: { state: PrototypeLineState; className?: string }) {
  return <StatusBadge status={STATE_BADGE[state]} label={PROTOTYPE_STATE_LABELS[state]} className={className} />;
}

export function openCountText(open: number): string {
  if (open === 0) return "Nothing open";
  return `${open} ${open === 1 ? "line" : "lines"} open`;
}

/** Marks a reviewer note that is not part of the design. */
export function ProtoNote({ children }: { children: ReactNode }) {
  return (
    <p className="border border-dashed border-[var(--clr-orange)] px-12 py-8 body-caption text-[var(--color-text-secondary)]">
      <span className="font-medium text-[var(--acc-prod-ink)]">Prototype note. </span>
      {children}
    </p>
  );
}

export function EmissionsBreadcrumb({ code }: { code: string }) {
  const href = useEmissionsHref();
  return (
    <nav aria-label="Breadcrumb" className="body-small text-[var(--color-text-secondary)]">
      <ol className="flex items-center gap-6">
        <li>
          <Link href={href()} className="inline-flex min-h-44 items-center underline underline-offset-4 hover:text-[var(--color-text-primary)]">
            Emissions
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li aria-current="page" className="font-medium text-[var(--color-text-primary)]">{code}</li>
      </ol>
    </nav>
  );
}

/** A quiet show/hide control for progressive disclosure. */
export function DisclosureButton({ open, onToggle, children, className }: { open: boolean; onToggle: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={cn("inline-flex min-h-44 items-center gap-6 body-small font-medium text-[var(--color-text-interaction-primary)] hover:underline underline-offset-4", className)}
    >
      {open ? <CaretDownIcon size={16} weight="bold" /> : <CaretRightIcon size={16} weight="bold" />}
      {children}
    </button>
  );
}

/* ---------- line details (on demand) ---------- */

const RULE_TEXT = {
  additive: "Entries add to the figures from records.",
  single: "One entry per credit batch.",
  none: "Filled from records. It takes no entries.",
} as const;

export function EntryList({ line }: { line: PrototypeLine }) {
  if (!line.entries.length) return <p className="body-small text-[var(--color-text-tertiary)]">None</p>;
  return (
    <ul className="flex flex-col">
      {line.entries.map((entry) => (
        <li key={entry.id} className="flex flex-col gap-2 [border-top:var(--row-divider)] py-8 first:[border-top:none] first:pt-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-12">
            <span className="body-small font-medium tabular-nums">{entryText(line.def, entry)}</span>
            <span className="body-caption text-[var(--color-text-tertiary)]">{formatDate(entry.date)}</span>
          </div>
          {entry.kind === "value" && (
            <span className={cn("inline-flex items-center gap-4 body-caption", entry.files.length ? "text-[var(--color-text-secondary)]" : "text-[var(--st-wait)]")}>
              {entry.files.length ? <FileIcon size={14} /> : <WarningIcon size={14} weight="bold" />}
              {entry.files.length ? entry.files.join(", ") : "File missing"}
            </span>
          )}
          {!entry.counts && <span className="body-caption text-[var(--st-wait)]">Stopped counting after a template change</span>}
          {entry.note && <span className="body-caption text-[var(--color-text-secondary)]">{entry.note}</span>}
        </li>
      ))}
    </ul>
  );
}

export function LineDetails({ line, onAdd }: { line: PrototypeLine; onAdd?: () => void }) {
  const { def, auto } = line;
  const rows: { label: string; value: ReactNode }[] = [];
  if (def.recordsLabel) {
    rows.push({
      label: "From records",
      value: auto ? `${formatFigure(auto.value, def.unit)} from ${def.recordsLabel.toLowerCase()} (${auto.detail})` : `None yet from ${def.recordsLabel.toLowerCase()}`,
    });
  }
  if (def.rule !== "none") rows.push({ label: "Entries", value: <EntryList line={line} /> });
  rows.push({ label: "Unit", value: def.unit });
  rows.push({ label: "Entry rule", value: RULE_TEXT[def.rule] });
  rows.push({ label: "Description", value: <span className="whitespace-pre-line">{def.description}</span> });
  return (
    <div className="flex flex-col gap-12">
      <dl className="grid grid-cols-1 gap-x-24 gap-y-12 sm:grid-cols-[160px_1fr]">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="body-small text-[var(--color-text-secondary)]">{row.label}</dt>
            <dd className="body-small min-w-0 break-words">{row.value}</dd>
          </div>
        ))}
      </dl>
      {onAdd && def.rule === "additive" && !line.open && (
        <div>
          <Button size="small" variant="weak" onClick={onAdd}>Add entry</Button>
        </div>
      )}
    </div>
  );
}

/* ---------- needs review: the entry stays visible ---------- */

export function ReviewBlock({ line, batch, onEnterAgain }: { line: PrototypeLine; batch: PrototypeBatch; onEnterAgain: () => void }) {
  const toast = useToast();
  const entry = line.review[0];
  if (!entry) return null;
  return (
    <div className="flex flex-col gap-8">
      <p className="body-small">
        <span className="font-medium tabular-nums">{entryText(line.def, entry)}</span>
        <span className="text-[var(--color-text-secondary)]">{` on ${formatDate(entry.date)}. The template line changed after this entry, so it does not count until you confirm it.`}</span>
      </p>
      <div className="flex flex-wrap gap-8">
        <Button size="small" variant="primary" onClick={() => { prototypeActions.confirm(batch, line.def.id); toast.success(`${line.def.name} confirmed.`); }}>
          Confirm
        </Button>
        <Button size="small" variant="weak" onClick={onEnterAgain}>Enter again</Button>
      </div>
    </div>
  );
}

/* ---------- next action ---------- */

export type SheetMode = "add" | "edit" | "again" | "nothing";
export interface SheetTarget { batchId: string; lineId: string; mode: SheetMode; entryId?: string }

/** The one next action for a line, or null when nothing is due. */
export function nextAction(line: PrototypeLine): { label: string; mode: SheetMode | "setup" | "review" } | null {
  switch (line.state) {
    case "empty": return line.def.rule === "none" ? null : { label: "Add entry", mode: "add" };
    case "missingEvidence": return { label: "Add file", mode: "edit" };
    case "needsReview": return { label: "Review", mode: "review" };
    case "needsSetup": return { label: "Open credit batch", mode: "setup" };
    default: return null;
  }
}

export function creditBatchSheetHref(batch: PrototypeBatch, withPanel = false): string {
  return `/credit-batches?batch=${batch.id}${withPanel ? "&prototype=emissions" : ""}`;
}

export function NeedsSetupText() {
  return <p className="body-small text-[var(--color-text-secondary)]">The template line has no supported shape. Pick another Removal template or ask support to add the mapping.</p>;
}

/* ---------- entry sheet ---------- */

export function useEntrySheet() {
  const [target, setTarget] = useState<SheetTarget | null>(null);
  const [open, setOpen] = useState(false);
  return {
    target,
    open,
    show: (next: SheetTarget) => { setTarget(next); setOpen(true); },
    close: () => setOpen(false),
  };
}

const SHEET_TITLES: Record<SheetMode, string> = {
  add: "Add entry",
  edit: "Edit entry",
  again: "Enter again",
  nothing: "Nothing to record",
};

interface EntrySheetProps {
  sheet: ReturnType<typeof useEntrySheet>;
  batches: BatchView[];
}

export function EntrySheet({ sheet, batches }: EntrySheetProps) {
  const view = batches.find((b) => b.batch.id === sheet.target?.batchId);
  const line = view?.lines.find((l) => l.def.id === sheet.target?.lineId);
  return (
    <SlideOverPanelRoot open={sheet.open && !!line} onOpenChange={(next) => !next && sheet.close()}>
      <SlideOverPanelContent size="default">
        {view && line && sheet.target && (
          <EntryForm
            key={`${sheet.target.batchId}-${sheet.target.lineId}-${sheet.target.mode}-${sheet.target.entryId ?? ""}`}
            target={sheet.target}
            batch={view.batch}
            line={line}
            onDone={sheet.close}
          />
        )}
      </SlideOverPanelContent>
    </SlideOverPanelRoot>
  );
}

interface FormValues {
  value: string; mass: string; distance: string; concentration: string; massFlow: string;
  date: string; note: string; files: DeferredFileEntry[]; existingFiles: string[];
}

function parseAmount(raw: string): number | null {
  if (!/^\d+(?:\.\d+)?$/.test(raw.trim())) return null;
  return Number(raw);
}

function EntryForm({ target, batch, line, onDone }: { target: SheetTarget; batch: PrototypeBatch; line: PrototypeLine; onDone: () => void }) {
  const toast = useToast();
  const { def } = line;
  const editing = target.mode === "edit" ? line.entries.find((e) => e.id === target.entryId) ?? line.values.find((e) => !e.files.length) : undefined;
  const again = target.mode === "again" ? line.review[0] : undefined;
  const seed = editing ?? again;
  const defaultDate = batch.endDate < TODAY ? batch.endDate : TODAY;
  const [values, setValues] = useState<FormValues>({
    value: seed?.value?.toString() ?? "", mass: seed?.mass?.toString() ?? "", distance: seed?.distance?.toString() ?? "",
    concentration: seed?.concentration?.toString() ?? "", massFlow: seed?.massFlow?.toString() ?? "",
    date: seed?.date ?? defaultDate, note: seed?.note ?? "", files: [], existingFiles: editing?.files ?? [],
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [more, setMore] = useState(target.mode === "nothing");
  const set = (key: keyof FormValues) => (event: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: event.target.value }));
  const nothing = target.mode === "nothing";

  // What this entry adds to, so a double count shows before save.
  const others = line.values.filter((e) => e.id !== editing?.id);
  const baseTotal = (line.auto?.value ?? 0) + others.reduce((sum, e) => sum + entryAmount(def, e), 0);
  const baseSources = [line.auto ? "runs" : null, others.length ? (others.length === 1 ? "1 earlier entry" : `${others.length} earlier entries`) : null].filter(Boolean).join(" and ");
  const addsTo = def.rule === "additive" && baseSources && !nothing ? `Adds to ${formatFigure(baseTotal, def.unit)} from ${baseSources}` : undefined;
  const mass = parseAmount(values.mass);
  const distance = parseAmount(values.distance);
  const product = mass != null && distance != null ? formatFigure((mass * distance) / KG_PER_TONNE, def.unit) : undefined;

  const save = () => {
    const next: typeof errors = {};
    const need = (key: keyof FormValues) => { if (parseAmount(values[key] as string) == null) next[key] = "Enter a non-negative decimal value."; };
    if (nothing) {
      if (!values.note.trim()) next.note = "Enter a note that says why there is nothing to record.";
    } else if (def.shape === "gas") { need("concentration"); need("massFlow"); }
    else if (def.shape === "massDistance") { need("mass"); need("distance"); }
    else need("value");
    if (!values.date) next.date = "Enter a valid entry date.";
    else if (values.date < batch.startDate) next.date = "Entry date cannot be before the credit batch start date.";
    else if (values.date > TODAY) next.date = "Entry date cannot be in the future at this facility.";
    setErrors(next);
    if (Object.keys(next).length) { if (next.note) setMore(true); return; }
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
    else prototypeActions.addEntry(batch, def.id, draft, again ? line.review.map((e) => e.id) : []);
    toast.success(nothing ? `${def.name} marked nothing to record.` : `Entry saved on ${def.name}.`);
    onDone();
  };

  const fileCount = values.existingFiles.length + values.files.length;
  const amountFields = nothing ? null : def.shape === "gas" ? (
    GAS_INPUTS.map((input) => (
      <FormField
        key={input.key}
        id={`entry-${input.key}`}
        label={input.label}
        unit={input.unit}
        error={errors[input.key]}
        aside={more && input.key === "massFlow" ? `Dry feedstock ${formatNumber(batch.dryFeedstockT)} t` : undefined}
      >
        <Input id={`entry-${input.key}`} inputMode="decimal" value={values[input.key]} onChange={set(input.key)} />
      </FormField>
    ))
  ) : def.shape === "massDistance" ? (
    <>
      <FormField id="entry-mass" label="Mass" unit="kg" error={errors.mass}>
        <Input id="entry-mass" inputMode="decimal" value={values.mass} onChange={set("mass")} />
      </FormField>
      <FormField id="entry-distance" label="Distance" unit="km" error={errors.distance} cue={product ? `${product}${addsTo ? `. ${addsTo}` : ""}` : addsTo}>
        <Input id="entry-distance" inputMode="decimal" value={values.distance} onChange={set("distance")} />
      </FormField>
    </>
  ) : (
    <FormField id="entry-value" label={def.inputLabel} unit={def.unit} error={errors.value} cue={addsTo}>
      <Input id="entry-value" inputMode="decimal" value={values.value} onChange={set("value")} autoFocus />
    </FormField>
  );

  return (
    <>
      <SlideOverPanelHeader>
        <SlideOverPanelTitle>{SHEET_TITLES[target.mode]}</SlideOverPanelTitle>
        <SlideOverPanelDescription>{`${def.name} · ${batch.code}`}</SlideOverPanelDescription>
      </SlideOverPanelHeader>
      <SlideOverPanelBody>
        <div className="flex flex-col gap-20">
          {again && (
            <p className="body-small text-[var(--color-text-secondary)]">
              {`Replaces ${entryText(def, again)} from ${formatDate(again.date)}, which stopped counting after a template change.`}
            </p>
          )}
          {amountFields}
          {nothing && (
            <FormField id="entry-note" label="Note" required error={errors.note} cue="Say why there is nothing to record.">
              <FormTextarea id="entry-note" value={values.note} onChange={set("note")} placeholder={`For example: No staff flights in ${new Date(`${batch.startDate}T00:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" })}`} autoFocus />
            </FormField>
          )}
          <FormField id="entry-date" label={nothing ? "Date" : "Entry date"} error={errors.date}>
            <Input id="entry-date" type="date" value={values.date} min={batch.startDate} max={TODAY} onChange={set("date")} />
          </FormField>
          {nothing ? (
            <>
              <ProtoNote>
                This changes the plan. In the plan, recorded zeros are written only by the PR 4 Removal confirmation. Here the operator answers per line, with a note, and the line reads Nothing to record. No file is needed.
              </ProtoNote>
            </>
          ) : (
            <FormField id="entry-file" label="File" certifyRequired hint={def.yearlyReport ? "The evidence for this line is the yearly emissions test report." : undefined}>
              <div className="flex flex-col gap-8">
                {values.existingFiles.length > 0 && (
                  <ul className="flex flex-col gap-4">
                    {values.existingFiles.map((name) => (
                      <li key={name} className="inline-flex items-center gap-6 body-small"><FileIcon size={16} />{name}</li>
                    ))}
                  </ul>
                )}
                <FormFileUpload
                  id="entry-file"
                  deferred
                  deferredFiles={values.files}
                  onDeferredAdd={(files) => setValues((v) => ({ ...v, files: [...v.files, ...files.map((file) => ({ key: `${file.name}-${file.size}-${v.files.length}`, file }))] }))}
                  onDeferredRemove={(key) => setValues((v) => ({ ...v, files: v.files.filter((f) => f.key !== key) }))}
                />
                {def.yearlyReport && !values.existingFiles.includes(YEARLY_REPORT_FILE) && (
                  <div>
                    <Button size="small" variant="weak" onClick={() => setValues((v) => ({ ...v, existingFiles: [...v.existingFiles, YEARLY_REPORT_FILE] }))}>
                      {`Use ${YEARLY_REPORT_FILE}`}
                    </Button>
                  </div>
                )}
                {fileCount === 0 && !def.yearlyReport && <p className="body-caption text-[var(--color-text-tertiary)]">You can save without a file. The line then reads File missing.</p>}
              </div>
            </FormField>
          )}
          {!nothing && (
            <div className="flex flex-col gap-16 border-t border-[var(--color-border-tertiary)] pt-8">
              <DisclosureButton open={more} onToggle={() => setMore((m) => !m)}>More</DisclosureButton>
              {more && (
                <div className="flex flex-col gap-20">
                  <FormField id="entry-note" label="Note">
                    <FormTextarea id="entry-note" value={values.note} onChange={set("note")} />
                  </FormField>
                  <div className="flex flex-col gap-6">
                    <p className="body-small font-medium">Line description</p>
                    <p className="body-small whitespace-pre-line text-[var(--color-text-secondary)]">{def.description}</p>
                    {def.shape === "gas" && (
                      <p className="body-small">{`Dry feedstock in ${batch.code}: ${formatNumber(batch.dryFeedstockT)} t`}</p>
                    )}
                  </div>
                  <div className="flex flex-col gap-6">
                    <p className="body-small font-medium">Earlier entries</p>
                    <EntryList line={{ ...line, entries: line.entries.filter((e) => e.id !== editing?.id) }} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </SlideOverPanelBody>
      <SlideOverPanelFooter>
        <Button variant="weak" onClick={onDone}>Cancel</Button>
        <Button variant="primary" onClick={save}>Save</Button>
      </SlideOverPanelFooter>
    </>
  );
}

/* ---------- facility activity totals (secondary, on demand) ---------- */

export function ActivityTotals({ batches, facilityName }: { batches: BatchView[]; facilityName: string | null }) {
  const rows = activityTotals(batches);
  return (
    <div className="flex flex-col gap-8">
      <div className="overflow-x-auto [border:var(--panel-border)] bg-[var(--paper)]">
        <table className="w-full min-w-[420px] body-small">
          <thead className="bg-[var(--sea)]">
            <tr className="text-left text-[var(--color-text-secondary)]">
              <th className="px-16 py-10 font-medium">Activity</th>
              <th className="px-16 py-10 text-right font-medium">From records</th>
              <th className="px-16 py-10 text-right font-medium">From entries</th>
              <th className="px-16 py-10 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.def.id} className="[border-top:var(--row-divider)]">
                <td className="px-16 py-10">{row.def.name}</td>
                <td className="px-16 py-10 text-right tabular-nums">{formatFigure(row.fromRecords, row.def.unit)}</td>
                <td className="px-16 py-10 text-right tabular-nums">{formatFigure(row.fromEntries, row.def.unit)}</td>
                <td className="px-16 py-10 text-right font-medium tabular-nums">{formatFigure(row.total, row.def.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="body-caption text-[var(--color-text-tertiary)]">
        {`${facilityName ?? "This facility"}, ${batches.length} credit batches. Entry litres and kWh count here.`}
      </p>
    </div>
  );
}

/* ---------- batch sheet Emissions panel ---------- */

export function BatchSheetEmissionsPanel({ view }: { view: BatchView }) {
  const href = useEmissionsHref();
  const pathname = usePathname();
  const onEmissions = pathname.startsWith("/emissions");
  return (
    <section aria-labelledby="batch-emissions-panel" className="flex flex-col gap-12 border border-[var(--color-border-secondary)] bg-[var(--paper)] p-20">
      <div className="flex items-baseline justify-between gap-12">
        <h3 id="batch-emissions-panel" className="body-small font-medium">Emissions</h3>
        <span className="body-caption text-[var(--color-text-tertiary)]">{openCountText(view.open.length)}</span>
      </div>
      {view.open.length ? (
        <ul className="flex flex-col">
          {view.open.map((line) => (
            <li key={line.def.id} className="flex items-center justify-between gap-12 [border-top:var(--row-divider)] py-8 first:[border-top:none]">
              <span className="min-w-0 body-small">{line.def.name}</span>
              <LineStateBadge state={line.state} className="shrink-0" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="body-small text-[var(--color-text-secondary)]">{`All ${view.lines.length} template lines are recorded.`}</p>
      )}
      {!onEmissions && (
        <Link href={href(view.batch.id)} className="inline-flex min-h-44 items-center body-small font-medium text-[var(--color-text-interaction-primary)] underline underline-offset-4">
          Open emissions
        </Link>
      )}
    </section>
  );
}

/** Mounted inside the real credit batch sheet when `?prototype=emissions`. */
export function InjectedBatchSheetEmissionsPanel({ creditBatchId }: { creditBatchId: string }) {
  const searchParams = useSearchParams();
  const { batches } = usePrototypeEmissions();
  if (process.env.NODE_ENV === "production" || searchParams.get("prototype") !== "emissions") return null;
  const view = batches.find((b) => b.batch.id === creditBatchId);
  if (!view) return null;
  return <BatchSheetEmissionsPanel view={view} />;
}
