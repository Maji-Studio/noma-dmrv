/**
 * PROTOTYPE detail C1, "Refined ledger": one ledger row per template line,
 * grouped as the template groups them, with an inline add row under the line
 * you act on and "More" for the full entry sheet. On top: breadcrumb and
 * prev/next, a 4-cell KPI strip, state chips and a sort. Built on the shared
 * detail API in prototype-detail-shared.tsx.
 */
"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { PaperclipIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField } from "@/components/forms";
import { Button, Input, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { GAS_INPUTS, PROTOTYPE_TEMPLATE_NAME, type PrototypeLine } from "./prototype-emissions-data";
import {
  EntrySheet,
  LineDetails,
  LineStateBadge,
  NeedsSetupText,
  ReviewBlock,
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
  lastEntryDate,
  useBatchDetail,
  type BatchDetail,
} from "./prototype-detail-shared";
import { PanelPreview } from "./prototype-variant-a";

type Data = ReturnType<typeof usePrototypeEmissions>;
const TODAY = new Date().toISOString().slice(0, 10);
const TH = "px-16 py-10 font-medium text-left whitespace-nowrap";
const TD = "px-16 py-12";
const COLUMNS = 5;

type AddMode = { lineId: string; nothing: boolean } | null;

export const DETAIL_C1_NAME = "Refined ledger";

export function DetailC1({ data, batchId }: { data: Data; batchId: string }) {
  const detail = useBatchDetail(data, batchId);
  const { view } = detail;
  const [adding, setAdding] = useState<AddMode>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const row = (line: PrototypeLine, showGroup: boolean) => (
    <LedgerRow
      key={line.def.id}
      line={line}
      detail={detail}
      showGroup={showGroup}
      adding={adding?.lineId === line.def.id ? adding : null}
      onAdd={(nothing) => setAdding(adding?.lineId === line.def.id && adding.nothing === nothing ? null : { lineId: line.def.id, nothing })}
      onCloseAdd={() => setAdding(null)}
      expanded={expanded === line.def.id}
      onToggle={() => setExpanded(expanded === line.def.id ? null : line.def.id)}
    />
  );

  return (
    <div className="container-max page-shell">
      <div className="flex flex-col gap-4">
        <DetailTopBar view={view} batches={data.batches} />
        <PageHeader
          title={view.batch.code}
          subtitle={`${batchPeriod(view.batch)}. ${PROTOTYPE_TEMPLATE_NAME}.`}
          actions={<Button variant="weak" aria-pressed={panelOpen} onClick={() => setPanelOpen((o) => !o)}>Batch sheet panel</Button>}
        />
      </div>
      {panelOpen && <PanelPreview view={view} />}
      <DetailKpiStrip detail={detail} />

      <div className="flex flex-col gap-12">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
          <LineStateChips detail={detail} />
          <LineSortSelect detail={detail} />
        </div>
        <div className="[border:var(--panel-border)] bg-[var(--paper)]">
          {detail.lines.length === 0 ? (
            <div className="p-16"><NoLinesMatch detail={detail} /></div>
          ) : (
            <table className="w-full body-small">
              <thead className="bg-[var(--sea)] text-[var(--color-text-secondary)]">
                <tr>
                  <th className={TH}>Line</th>
                  <th className={cn(TH, "hidden w-[148px] md:table-cell")}>State</th>
                  <th className={cn(TH, "w-[120px] text-right md:w-[184px]")}>Total</th>
                  <th className={cn(TH, "hidden w-[128px] lg:table-cell")}>Last entry</th>
                  <th className={cn(TH, "hidden w-[232px] sm:table-cell")}><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {detail.grouped
                  ? detail.groups.map((group) => (
                      <Fragment key={group.group}>
                        <tr className="border-t border-[var(--color-border-tertiary)]">
                          <th colSpan={COLUMNS} scope="colgroup" className="px-16 pt-16 pb-4 text-left body-caption font-medium text-[var(--color-text-tertiary)]">{group.group}</th>
                        </tr>
                        {group.lines.map((line) => row(line, false))}
                      </Fragment>
                    ))
                  : detail.lines.map((line) => row(line, true))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <EntrySheet sheet={detail.sheet} batches={data.batches} />
    </div>
  );
}

interface LedgerRowProps {
  line: PrototypeLine;
  detail: BatchDetail;
  showGroup: boolean;
  adding: AddMode;
  onAdd: (nothing: boolean) => void;
  onCloseAdd: () => void;
  expanded: boolean;
  onToggle: () => void;
}

function LedgerRow({ line, detail, showGroup, adding, onAdd, onCloseAdd, expanded, onToggle }: LedgerRowProps) {
  const { view, actions } = detail;
  const last = lastEntryDate(line);
  const missingFileEntry = line.values.find((e) => !e.files.length)?.id;
  const canAdd = line.def.rule !== "none" && line.state !== "needsReview" && line.state !== "needsSetup" && !(line.def.rule === "single" && line.values.length);
  let action: React.ReactNode = null;
  if (line.state === "missingEvidence") {
    action = <Button size="small" variant="default" onClick={() => actions.openSheet(line.def.id, "edit", missingFileEntry)}>Add file</Button>;
  } else if (line.state === "needsSetup" && view.batch.real) {
    action = <Link href={creditBatchSheetHref(view.batch)} className="inline-flex h-[32px] items-center border border-[var(--color-border-primary)] px-8 label-button">Set up</Link>;
  } else if (canAdd) {
    action = (
      <span className="inline-flex flex-wrap items-center gap-x-12 sm:justify-end">
        <Button size="small" variant={line.open ? "default" : "noOutline"} aria-expanded={!!adding && !adding.nothing} onClick={() => onAdd(false)}>
          {adding && !adding.nothing ? "Close" : "Add"}
        </Button>
        {line.state === "empty" && (
          <button type="button" aria-expanded={!!adding?.nothing} onClick={() => onAdd(true)} className="inline-flex min-h-44 items-center whitespace-nowrap body-small text-[var(--color-text-interaction-primary)] underline underline-offset-4">
            Nothing to record
          </button>
        )}
      </span>
    );
  }
  return (
    <>
      <tr className={cn("[border-top:var(--row-divider)] align-top", line.open && "bg-[var(--st-wait-bg)]/40")}>
        <td className={TD}>
          <button type="button" aria-expanded={expanded} onClick={onToggle} className="min-h-24 text-left hover:underline underline-offset-4">
            {line.def.name}
          </button>
          {showGroup && <span className="block body-caption text-[var(--color-text-tertiary)]">{line.def.group}</span>}
          <span className="mt-6 flex flex-wrap items-center gap-8 md:hidden">
            <LineStateBadge state={line.state} />
            <span className="sm:hidden">{action}</span>
          </span>
        </td>
        <td className={cn(TD, "hidden md:table-cell")}><LineStateBadge state={line.state} /></td>
        <td className={cn(TD, "text-right tabular-nums", !line.values.length && !line.auto && !line.nothing && "text-[var(--color-text-tertiary)]")}>
          {line.def.shape === "gas" && line.values.length ? (
            <>
              <span className="block whitespace-nowrap">{`${line.values[0].concentration} mg/kg`}</span>
              <span className="block whitespace-nowrap">{`${(line.values[0].massFlow ?? 0).toLocaleString("en-US")} kg`}</span>
            </>
          ) : line.state === "needsReview" ? "" : line.totalText}
        </td>
        <td className={cn(TD, "hidden whitespace-nowrap text-[var(--color-text-secondary)] lg:table-cell")}>{last ? formatDate(last) : "None"}</td>
        <td className={cn(TD, "hidden text-right sm:table-cell")}>{action}</td>
      </tr>
      {line.state === "needsReview" && (
        <tr><td colSpan={COLUMNS} className="px-16 pb-12"><ReviewBlock line={line} batch={view.batch} onEnterAgain={() => actions.openSheet(line.def.id, "again")} /></td></tr>
      )}
      {line.state === "needsSetup" && (
        <tr><td colSpan={COLUMNS} className="px-16 pb-12"><NeedsSetupText /></td></tr>
      )}
      {adding && (
        <tr className="bg-[var(--sea)]">
          <td colSpan={COLUMNS} className="px-16 py-12">
            <InlineAddRow
              key={`${line.def.id}-${adding.nothing}`}
              line={line}
              detail={detail}
              initialNothing={adding.nothing}
              onClose={onCloseAdd}
              onMore={() => { onCloseAdd(); actions.openSheet(line.def.id, "add"); }}
            />
          </td>
        </tr>
      )}
      {expanded && (
        <tr className="bg-[var(--sea)]">
          <td colSpan={COLUMNS} className="px-16 py-16"><LineDetails line={line} /></td>
        </tr>
      )}
    </>
  );
}

interface InlineAddRowProps {
  line: PrototypeLine;
  detail: BatchDetail;
  initialNothing: boolean;
  onClose: () => void;
  onMore: () => void;
}

function InlineAddRow({ line, detail, initialNothing, onClose, onMore }: InlineAddRowProps) {
  const { view, actions } = detail;
  const { def } = line;
  const defaultDate = view.batch.endDate < TODAY ? view.batch.endDate : TODAY;
  const [nothing, setNothing] = useState(initialNothing);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const valid = (raw: string) => /^\d+(?:\.\d+)?$/.test(raw.trim());
  const paired = def.shape === "gas" || def.shape === "massDistance";
  const labels = def.shape === "gas" ? GAS_INPUTS.map((i) => [i.label, i.unit]) : def.shape === "massDistance" ? [["Mass", "kg"], ["Distance", "km"]] : [[def.inputLabel, def.unit]];
  const month = new Date(`${view.batch.startDate}T00:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" });

  const save = () => {
    if (nothing) {
      if (!note.trim()) return setError("Enter a note that says why there is nothing to record.");
      actions.nothingToRecord(def.id, note.trim(), date);
      return onClose();
    }
    if (!valid(a) || (paired && !valid(b))) return setError("Enter a non-negative decimal value.");
    if (date < view.batch.startDate) return setError("Entry date cannot be before the credit batch start date.");
    const amounts = def.shape === "gas" ? { concentration: Number(a), massFlow: Number(b) } : def.shape === "massDistance" ? { mass: Number(a), distance: Number(b) } : { value: Number(a) };
    actions.addEntry(def.id, { kind: "value", date, note: "", files: file ? [file] : [], ...amounts });
    onClose();
  };

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-end gap-12">
        {nothing ? (
          <div className="w-full sm:min-w-[220px] sm:flex-1">
            <FormField id={`inline-${def.id}-note`} label="Note" required>
              <Input id={`inline-${def.id}-note`} value={note} onChange={(e) => setNote(e.target.value)} placeholder={`For example: No staff flights in ${month}`} autoFocus />
            </FormField>
          </div>
        ) : (
          labels.map(([label, unit], index) => (
            <div key={label} className="w-full sm:w-[220px]">
              <FormField id={`inline-${def.id}-${index}`} label={label} unit={unit}>
                <Input id={`inline-${def.id}-${index}`} inputMode="decimal" value={index === 0 ? a : b} onChange={(e) => (index === 0 ? setA : setB)(e.target.value)} autoFocus={index === 0} />
              </FormField>
            </div>
          ))
        )}
        <div className="w-full sm:w-[168px]">
          <FormField id={`inline-${def.id}-date`} label="Date">
            <Input id={`inline-${def.id}-date`} type="date" value={date} min={view.batch.startDate} max={TODAY} onChange={(e) => setDate(e.target.value)} />
          </FormField>
        </div>
        {!nothing && (
          <label className="inline-flex h-[40px] cursor-pointer items-center gap-6 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-12 body-small focus-within:border-[var(--color-interaction)]">
            <PaperclipIcon size={16} weight="bold" />
            <span className="max-w-[160px] truncate">{file ?? "Attach file"}</span>
            <input type="file" className="sr-only" onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)} />
          </label>
        )}
        <Button variant="primary" onClick={save}>Save</Button>
      </div>
      {error && <p role="alert" className="body-caption text-[var(--st-bad)]">{error}</p>}
      <div className="flex flex-wrap items-center gap-x-16">
        {line.state === "empty" && (
          <button type="button" onClick={() => { setNothing((n) => !n); setError(null); }} className="inline-flex min-h-44 items-center body-small text-[var(--color-text-interaction-primary)] underline underline-offset-4">
            {nothing ? "Enter a value instead" : "Nothing to record"}
          </button>
        )}
        {!nothing && (
          <button type="button" onClick={onMore} className="inline-flex min-h-44 items-center body-small text-[var(--color-text-interaction-primary)] underline underline-offset-4">
            More (note, description, earlier entries)
          </button>
        )}
        {def.rule === "additive" && line.total != null && !nothing && (
          <span className="body-caption text-[var(--color-text-tertiary)]">{`Adds to ${line.totalText}.`}</span>
        )}
      </div>
    </div>
  );
}
