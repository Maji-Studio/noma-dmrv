/**
 * One output-bin history entry: time first, then the line it reads as. It
 * opens into what changed per part with the stock after, then the batches,
 * moisture, source and who recorded it. An entry a correction replaced, or one
 * deleted, stays struck through and opens into why it no longer counts.
 */
"use client";

import { Button } from "@/components/ui";
import { Notice } from "@/components/ui/notice";
import { formatFacilityTime } from "@/lib/date-utils";
import { formatFacilityDateTime, formatMassKg } from "@/lib/format-utils";
import { reversalCaption } from "@/lib/loss-correction-messages";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import { outputStockEventLabel } from "@/lib/output-stock/labels";
import type { OutputStockHistoryEntry } from "@/types/output-stock";
import { MoistureResetChange } from "./moisture-reset-change";
import { entryAmount, entrySentence, formatPartFigures, MIN_SHOWN_CHANGE_KG, WET_MASS_LABEL, type HistoryRow } from "./output-stock-history-days";
import { LEDGER_SUMMARY_CLASS, LedgerCaret, LedgerFacts } from "./stock-ledger";
import { StockChip } from "./stock-figures";
import { StockSourceLink } from "./stock-source-link";
import type { ReactNode } from "react";

const TIME_FORMAT = "HH:mm";
const MUTED = "text-[var(--color-text-tertiary)]";
const SECONDARY = "text-[var(--color-text-secondary)]";
const RULE = "border-b border-[var(--color-border-secondary)]";
const TH = `py-6 pr-12 text-left font-normal body-caption ${MUTED}`;

/** A mode change moves no stock; it changes how every later draw is taken. */
const MODE_CHANGE_CAPTIONS: Record<string, string> = {
  merge: "From here on the bin is one blended pile: each draw takes from every batch in proportion to what it holds.",
  split: "From here on each batch added is kept apart as its own sub-bin.",
};

/** The element id an entry renders with: the target of links between entries. */
function entryElementId(entryId: string): string {
  return `output-movement-${entryId}`;
}

/** Opens another entry of the same history, scrolls to it and moves focus to it. */
function openEntry(entryId: string) {
  const target = document.getElementById(entryElementId(entryId));
  if (!(target instanceof HTMLDetailsElement)) return;
  target.open = true;
  target.scrollIntoView({ block: "nearest" });
  target.querySelector("summary")?.focus({ preventScroll: true });
}

/** A reference to another entry: a link when that entry is in the list, else its text. */
function EntryLink({ entryId, linked, children }: { entryId: string; linked: boolean; children: ReactNode }) {
  if (!linked) return <>{children}</>;
  return (
    <a href={`#${entryElementId(entryId)}`} className="underline underline-offset-4"
      onClick={(event) => { event.preventDefault(); openEntry(entryId); }}>
      {children}
    </a>
  );
}

export function isModeChange(entry: OutputStockHistoryEntry): boolean {
  return entry.kind in MODE_CHANGE_CAPTIONS;
}

/** A mode change, or another row that moves no stock: a line in the list, not an entry that opens. */
export function HistoryBreak({ entry, timeZone, facilityId }: { entry: OutputStockHistoryEntry; timeZone: string; facilityId: string }) {
  return (
    <div id={entryElementId(entry.id)} className={`grid grid-cols-[40px_minmax(0,1fr)] gap-8 ${RULE} py-10 body-caption ${SECONDARY}`}>
      <span className={`tabular-nums ${MUTED}`}>{formatFacilityTime(new Date(entry.occurredAt), timeZone, TIME_FORMAT)}</span>
      <span className="flex min-w-0 flex-col">
        <span><span className="font-medium text-[var(--color-text-primary)]">{outputStockEventLabel(entry.kind)}.</span> {MODE_CHANGE_CAPTIONS[entry.kind]}</span>
        {entry.moistureReset && <MoistureResetChange reset={entry.moistureReset} named={false} />}
        <StockSourceLink source={entry.source} facilityId={facilityId} />
      </span>
    </div>
  );
}

/** What the entry changed per part: Change and After, with wet mass as the total underneath. */
function PartsTable({ row, subject }: { row: HistoryRow; subject: string }) {
  if (row.parts.length === 0 && !row.wet) return null;
  return (
    <table aria-label={`What changed in the ${subject}`} className="w-full tabular-nums body-caption">
      <thead>
        <tr className={RULE}><th scope="col" className={TH}>Part</th><th scope="col" className={`${TH} text-right`}>Change</th><th scope="col" className={`${TH} pr-0 text-right`}>After</th></tr>
      </thead>
      <tbody>
        {row.parts.map((part) => {
          const figures = formatPartFigures(part);
          return (
            <tr key={part.label} className={RULE}>
              <th scope="row" className="py-6 pr-12 text-left font-normal">{part.label}</th>
              <td className={`py-6 pr-12 text-right ${SECONDARY}`}>{figures.change ?? ""}</td>
              <td className="py-6 text-right">{figures.after}</td>
            </tr>
          );
        })}
        {row.wet && (() => {
          const wet = formatPartFigures({ label: WET_MASS_LABEL, ...row.wet, estimated: true });
          return (
            <tr className="font-medium">
              <th scope="row" className="py-6 pr-12 text-left font-medium">{WET_MASS_LABEL}</th>
              <td className="py-6 pr-12 text-right">{wet.change}</td>
              <td className="py-6 text-right">{wet.after}</td>
            </tr>
          );
        })()}
      </tbody>
    </table>
  );
}

/** The wet change the entry was saved with, when a later entry has since moved today's estimate of it. Null when they agree. */
export function savedWetChange(row: HistoryRow): string | null {
  const { savedWetDeltaKg, wetDeltaKg } = row.entry;
  if (row.status !== "counts" || savedWetDeltaKg == null || wetDeltaKg == null) return null;
  if (Math.abs(savedWetDeltaKg - wetDeltaKg) < MIN_SHOWN_CHANGE_KG) return null;
  const figure = formatPartFigures({ label: WET_MASS_LABEL, changeKg: savedWetDeltaKg, afterKg: 0, estimated: true }).change;
  return `${WET_MASS_LABEL} ${figure}. A later entry changed this estimate.`;
}

function facts(row: HistoryRow, timeZone: string, linked: boolean) {
  const { entry, replaces, replacedBy, reversedBy } = row;
  const recordedLater = entry.recordedAt.slice(0, 16) !== entry.occurredAt.slice(0, 16);
  const batches = entry.allocations.map((allocation) => allocation.code);
  const saved = savedWetChange(row);
  return [
    ...(saved ? [{ label: "When saved", value: saved }] : []),
    ...(batches.length > 0 ? [{ label: batches.length === 1 ? "Batch" : "Batches", value: batches.join(", ") }] : []),
    ...(entry.moisturePercent !== null ? [{ label: "Moisture", value: formatMoisturePercent(entry.moisturePercent) }] : []),
    ...(replaces ? [{ label: "Replaces", value: <EntryLink entryId={replaces.id} linked={linked}>{`${entryAmount(replaces, row.kind, formatMassKg)}, ${formatFacilityDateTime(replaces.occurredAt, timeZone)}`}</EntryLink> }] : []),
    ...(entry.reason && entry.kind !== "intake" ? [{ label: replaces ? "Why corrected" : "Reason", value: entry.reason }] : []),
    // A deleted Lost mass keeps the operator's reason on the crossed-out entry, as on feedstock bins.
    ...(row.kind === "loss" && reversedBy && !replacedBy && reversedBy.reason ? [{ label: "Why deleted", value: reversedBy.reason }] : []),
    { label: "Recorded", value: `${recordedLater ? formatFacilityDateTime(entry.recordedAt, timeZone) : "At the time"}${entry.actorName ? ` by ${entry.actorName}` : ""}` },
  ];
}

export function HistoryEntry({ row, defaultOpen, linked, timeZone, facilityId, onEdit, onDelete }: {
  row: HistoryRow;
  defaultOpen: boolean;
  /** True when every entry is in the list, so references between entries can link. */
  linked: boolean;
  timeZone: string;
  facilityId: string;
  onEdit: (entry: OutputStockHistoryEntry) => void;
  onDelete: (entry: OutputStockHistoryEntry) => void;
}) {
  const { entry, status } = row;
  const struck = status !== "counts";
  const subject = `${outputStockEventLabel(row.kind).toLowerCase()} on ${formatFacilityDateTime(entry.occurredAt, timeZone)}`;
  return (
    <details id={entryElementId(entry.id)} open={defaultOpen} className={`group ${RULE}`}>
      <summary className={`${LEDGER_SUMMARY_CLASS} grid-cols-[40px_minmax(0,1fr)_14px]`}>
        <span className={`pt-2 body-caption tabular-nums ${MUTED}`}>{formatFacilityTime(new Date(entry.occurredAt), timeZone, TIME_FORMAT)}</span>
        <span className="flex flex-wrap items-center gap-6 body-small font-medium tabular-nums">
          <span className={struck ? `line-through ${MUTED}` : undefined}>{entrySentence(row, formatMassKg)}</span>
          {struck && <StockChip>{status === "replaced" ? "Replaced" : "Reversed"}</StockChip>}
        </span>
        <LedgerCaret />
      </summary>
      <div className="flex flex-col gap-10 pb-16 sm:pl-48">
        {struck && (
          <p className={`body-caption ${SECONDARY}`}>
            {row.replacedBy
              ? <>Replaced by <EntryLink entryId={row.replacedBy.id} linked={linked}>the correction recorded {formatFacilityDateTime(row.replacedBy.recordedAt, timeZone)}</EntryLink>. It no longer counts toward the stock.</>
              : reversalCaption(row.reversedBy ? { recordedAt: row.reversedBy.recordedAt, actorName: row.reversedBy.actorName, replaced: false } : null, timeZone)}
          </p>
        )}
        <PartsTable row={row} subject={subject} />
        {row.moistureEntry?.moistureReset && <MoistureResetChange reset={row.moistureEntry.moistureReset} />}
        <LedgerFacts facts={facts(row, timeZone, linked)} />
        {row.kind === "loss" && !struck && (entry.editLockedReason === null
          ? <div className="flex flex-wrap gap-8">
              <Button type="button" variant="noOutline" onClick={() => onEdit(entry)}>Edit</Button>
              <Button type="button" variant="noOutline" onClick={() => onDelete(entry)}>Delete</Button>
            </div>
          : entry.editLockedReason ? <Notice tone="info">{entry.editLockedReason}</Notice> : null)}
        <StockSourceLink source={entry.source} facilityId={facilityId} />
      </div>
    </details>
  );
}
