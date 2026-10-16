/**
 * PROTOTYPE variant C, "Ledger". Overview: credit batches × line states as a
 * count table. Sub-route: one ledger row per template line, grouped as the
 * template groups them, with an inline add row under the line you act on.
 * "More" in the add row opens the full entry sheet.
 */
"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PaperclipIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField } from "@/components/forms";
import { Button, Input, PageHeader, StatusBadge } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import {
  GAS_INPUTS,
  PROTOTYPE_STATE_LABELS,
  PROTOTYPE_TEMPLATE_NAME,
  prototypeActions,
  stateCounts,
  type PrototypeLine,
  type PrototypeLineState,
} from "./prototype-emissions-data";
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
  useEmissionsHref,
  useEntrySheet,
  type BatchView,
  type usePrototypeEmissions,
} from "./prototype-emissions-shared";
import { PanelPreview, SUBTITLE } from "./prototype-variant-a";

type Data = ReturnType<typeof usePrototypeEmissions>;
type Sheet = ReturnType<typeof useEntrySheet>;
const TODAY = new Date().toISOString().slice(0, 10);
const COUNT_COLUMNS: PrototypeLineState[] = ["needsReview", "missingEvidence", "empty", "needsSetup"];
const TH = "px-16 py-10 font-medium text-left whitespace-nowrap";
const TD = "px-16 py-12";

export function VariantC({ data, batchId }: { data: Data; batchId?: string }) {
  return batchId ? <LineLedger data={data} batchId={batchId} /> : <BatchLedger data={data} />;
}

function BatchLedger({ data }: { data: Data }) {
  const router = useRouter();
  const href = useEmissionsHref();
  const [totalsOpen, setTotalsOpen] = useState(false);
  return (
    <div className="container-max page-shell">
      <PageHeader area="infrastructure" title="Emissions" subtitle={SUBTITLE} />
      <div className="overflow-x-auto [border:var(--panel-border)] bg-[var(--paper)]">
        <table className="w-full body-small">
          <thead className="bg-[var(--sea)] text-[var(--color-text-secondary)]">
            <tr>
              <th className={TH}>Credit batch</th>
              <th className={cn(TH, "hidden lg:table-cell")}>Period</th>
              <th className={cn(TH, "hidden sm:table-cell")}>Status</th>
              {COUNT_COLUMNS.map((state) => (
                <th key={state} className={cn(TH, "hidden text-right md:table-cell")}>{PROTOTYPE_STATE_LABELS[state]}</th>
              ))}
              <th className={cn(TH, "text-right")}>Open</th>
            </tr>
          </thead>
          <tbody>
            {data.batches.map(({ batch, lines, open }) => {
              const counts = stateCounts(lines);
              return (
                <tr
                  key={batch.id}
                  onClick={() => router.push(href(batch.id))}
                  className="cursor-pointer [border-top:var(--row-divider)] hover:bg-[var(--row-hover-bg-solid)]"
                >
                  <td className={TD}>
                    <Link href={href(batch.id)} onClick={(e) => e.stopPropagation()} className="font-medium text-[var(--acc-dist-ink)] underline-offset-4 hover:underline">{batch.code}</Link>
                    <span className="block body-caption text-[var(--color-text-tertiary)] lg:hidden">{batchPeriod(batch)}</span>
                  </td>
                  <td className={cn(TD, "hidden whitespace-nowrap lg:table-cell")}>{batchPeriod(batch)}</td>
                  <td className={cn(TD, "hidden sm:table-cell")}><StatusBadge status={batch.status} size="small" /></td>
                  {COUNT_COLUMNS.map((state) => (
                    <td key={state} className={cn(TD, "hidden text-right tabular-nums md:table-cell", !counts[state] && "text-[var(--color-text-tertiary)]")}>{counts[state]}</td>
                  ))}
                  <td className={cn(TD, "text-right font-medium tabular-nums", !open.length && "text-[var(--color-text-tertiary)] font-normal")}>
                    {`${open.length} of ${lines.length}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-12">
        <DisclosureButton open={totalsOpen} onToggle={() => setTotalsOpen((o) => !o)} className="self-start">Facility activity totals</DisclosureButton>
        {totalsOpen && <ActivityTotals batches={data.batches} facilityName={data.facilityName} />}
      </div>
    </div>
  );
}

function LineLedger({ data, batchId }: { data: Data; batchId: string }) {
  const view = data.batches.find((b) => b.batch.id === batchId)!;
  const sheet = useEntrySheet();
  const [adding, setAdding] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const groups = [...new Set(view.lines.map((line) => line.def.group))];
  return (
    <div className="container-max page-shell">
      <div className="flex flex-col gap-4">
        <EmissionsBreadcrumb code={view.batch.code} />
        <PageHeader
          title={view.batch.code}
          subtitle={`${batchPeriod(view.batch)}. ${PROTOTYPE_TEMPLATE_NAME}. ${view.open.length} of ${view.lines.length} lines open.`}
          actions={<Button variant="weak" aria-pressed={panelOpen} onClick={() => setPanelOpen((o) => !o)}>Batch sheet panel</Button>}
        />
      </div>
      {panelOpen && <PanelPreview view={view} />}
      <div className="[border:var(--panel-border)] bg-[var(--paper)]">
        <table className="w-full body-small">
          <thead className="bg-[var(--sea)] text-[var(--color-text-secondary)]">
            <tr>
              <th className={TH}>Line</th>
              <th className={cn(TH, "hidden w-[148px] md:table-cell")}>State</th>
              <th className={cn(TH, "w-[120px] text-right md:w-[200px]")}>Total</th>
              <th className={cn(TH, "hidden w-[140px] lg:table-cell")}>Last entry</th>
              <th className={cn(TH, "hidden w-[112px] sm:table-cell")}><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group}>
                <tr className="border-t border-[var(--color-border-tertiary)]">
                  <th colSpan={5} scope="colgroup" className="px-16 pt-16 pb-4 text-left body-caption font-medium text-[var(--color-text-tertiary)]">{group}</th>
                </tr>
                {view.lines.filter((line) => line.def.group === group).map((line) => (
                  <LedgerRow
                    key={line.def.id}
                    line={line}
                    view={view}
                    sheet={sheet}
                    adding={adding === line.def.id}
                    onAdd={() => setAdding(adding === line.def.id ? null : line.def.id)}
                    onCloseAdd={() => setAdding(null)}
                    expanded={expanded === line.def.id}
                    onToggle={() => setExpanded(expanded === line.def.id ? null : line.def.id)}
                  />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <EntrySheet sheet={sheet} batches={data.batches} />
    </div>
  );
}

interface LedgerRowProps {
  line: PrototypeLine; view: BatchView; sheet: Sheet;
  adding: boolean; onAdd: () => void; onCloseAdd: () => void;
  expanded: boolean; onToggle: () => void;
}

function LedgerRow({ line, view, sheet, adding, onAdd, onCloseAdd, expanded, onToggle }: LedgerRowProps) {
  const last = [...line.entries].sort((a, b) => b.date.localeCompare(a.date))[0];
  const showSheet = (mode: "edit" | "again") =>
    sheet.show({ batchId: view.batch.id, lineId: line.def.id, mode, entryId: mode === "edit" ? line.values.find((e) => !e.files.length)?.id : undefined });
  let action: React.ReactNode = null;
  if (line.state === "missingEvidence") action = <Button size="small" variant="default" onClick={() => showSheet("edit")}>Add file</Button>;
  else if (line.state === "needsSetup" && view.batch.real) action = <Link href={creditBatchSheetHref(view.batch)} className="inline-flex h-[32px] items-center border border-[var(--color-border-primary)] px-8 label-button">Set up</Link>;
  else if (line.def.rule !== "none" && line.state !== "needsReview" && line.state !== "needsSetup" && !(line.def.rule === "single" && line.values.length)) {
    action = <Button size="small" variant={line.open ? "default" : "noOutline"} aria-expanded={adding} onClick={onAdd}>{adding ? "Close" : "Add"}</Button>;
  }
  return (
    <>
      <tr className={cn("[border-top:var(--row-divider)] align-top", line.open && "bg-[var(--st-wait-bg)]/40")}>
        <td className={TD}>
          <button type="button" aria-expanded={expanded} onClick={onToggle} className="min-h-24 text-left hover:underline underline-offset-4">
            {line.def.name}
          </button>
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
        <td className={cn(TD, "hidden text-[var(--color-text-secondary)] lg:table-cell")}>{last ? formatDate(last.date) : "None"}</td>
        <td className={cn(TD, "hidden text-right sm:table-cell")}>{action}</td>
      </tr>
      {line.state === "needsReview" && (
        <tr><td colSpan={5} className="px-16 pb-12"><ReviewBlock line={line} batch={view.batch} onEnterAgain={() => showSheet("again")} /></td></tr>
      )}
      {line.state === "needsSetup" && (
        <tr><td colSpan={5} className="px-16 pb-12"><NeedsSetupText /></td></tr>
      )}
      {adding && (
        <tr className="bg-[var(--sea)]">
          <td colSpan={5} className="px-16 py-12">
            <InlineAddRow line={line} view={view} onClose={onCloseAdd} onMore={() => { onCloseAdd(); sheet.show({ batchId: view.batch.id, lineId: line.def.id, mode: "add" }); }} />
          </td>
        </tr>
      )}
      {expanded && (
        <tr className="bg-[var(--sea)]">
          <td colSpan={5} className="px-16 py-16"><LineDetails line={line} /></td>
        </tr>
      )}
    </>
  );
}

function InlineAddRow({ line, view, onClose, onMore }: { line: PrototypeLine; view: BatchView; onClose: () => void; onMore: () => void }) {
  const toast = useToast();
  const { def } = line;
  const defaultDate = view.batch.endDate < TODAY ? view.batch.endDate : TODAY;
  const [nothing, setNothing] = useState(false);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const valid = (raw: string) => /^\d+(?:\.\d+)?$/.test(raw.trim());
  const paired = def.shape === "gas" || def.shape === "massDistance";
  const labels = def.shape === "gas" ? GAS_INPUTS.map((i) => [i.label, i.unit]) : def.shape === "massDistance" ? [["Mass", "kg"], ["Distance", "km"]] : [[def.inputLabel, def.unit]];

  const save = () => {
    if (nothing) {
      if (!note.trim()) return setError("Enter a note that says why there is nothing to record.");
      prototypeActions.addEntry(view.batch, def.id, { kind: "nothing", date, files: [], note: note.trim() });
      toast.success(`${def.name} marked nothing to record.`);
      return onClose();
    }
    if (!valid(a) || (paired && !valid(b))) return setError("Enter a non-negative decimal value.");
    if (date < view.batch.startDate) return setError("Entry date cannot be before the credit batch start date.");
    const amounts = def.shape === "gas" ? { concentration: Number(a), massFlow: Number(b) } : def.shape === "massDistance" ? { mass: Number(a), distance: Number(b) } : { value: Number(a) };
    prototypeActions.addEntry(view.batch, def.id, { kind: "value", date, note: "", files: file ? [file] : [], ...amounts });
    toast.success(`Entry saved on ${def.name}.`);
    onClose();
  };

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-end gap-12">
        {nothing ? (
          <div className="min-w-[220px] flex-1">
            <FormField id={`inline-${def.id}-note`} label="Note" required>
              <Input id={`inline-${def.id}-note`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="No staff flights in September" autoFocus />
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
