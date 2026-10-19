/**
 * One output-bin history entry: time first, then the line it reads as. It
 * opens into what changed per part with the stock after, then the batches,
 * moisture, source and who recorded it. An entry a correction replaced stays,
 * struck through, and opens into why it no longer counts.
 */
"use client";

import { Button } from "@/components/ui";
import { Notice } from "@/components/ui/notice";
import { formatFacilityTime } from "@/lib/date-utils";
import { formatFacilityDateTime, formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import { outputStockEventLabel } from "@/lib/output-stock/labels";
import type { OutputStockHistoryEntry } from "@/types/output-stock";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr";
import { MoistureResetChange } from "./moisture-reset-change";
import { entryAmount, entrySentence, WET_MASS_LABEL, type HistoryRow } from "./output-stock-history-days";
import { LedgerFacts } from "./stock-ledger";
import { StockChip } from "./stock-figures";
import { StockSourceLink } from "./stock-source-link";
import { formatWetEstimate } from "./stock-preview-shared";

const CARET_ICON_PX = 14;
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

/** Wet mass and the water in it are estimates, read in whole kg as the bin's headline reads them. */
function estimateKg(kg: number): string {
  return `${formatWetEstimate(kg)} kg`;
}

/** A change with a real minus sign, and a plus for stock in. */
function signedKg(kg: number, format: (kg: number) => string = formatMassKg): string {
  if (format(kg) === format(0)) return format(0);
  return `${kg > 0 ? "+" : "−"}${format(Math.abs(kg))}`;
}

export function isModeChange(entry: OutputStockHistoryEntry): boolean {
  return entry.kind in MODE_CHANGE_CAPTIONS;
}

/** A mode change, or another row that moves no stock: a line in the list, not an entry that opens. */
export function HistoryBreak({ entry, timeZone, facilityId }: { entry: OutputStockHistoryEntry; timeZone: string; facilityId: string }) {
  return (
    <div id={`output-movement-${entry.id}`} className={`grid grid-cols-[40px_minmax(0,1fr)] gap-8 ${RULE} py-10 body-caption ${SECONDARY}`}>
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
          const format = part.estimated ? estimateKg : formatMassKg;
          return (
            <tr key={part.label} className={RULE}>
              <th scope="row" className="py-6 pr-12 text-left font-normal">{part.label}</th>
              <td className={`py-6 pr-12 text-right ${SECONDARY}`}>{part.changeKg === null ? "" : signedKg(part.changeKg, format)}</td>
              <td className="py-6 text-right">{format(part.afterKg)}</td>
            </tr>
          );
        })}
        {row.wet && (
          <tr className="font-medium">
            <th scope="row" className="py-6 pr-12 text-left font-medium">{WET_MASS_LABEL}</th>
            <td className="py-6 pr-12 text-right">{signedKg(row.wet.changeKg, estimateKg)}</td>
            <td className="py-6 text-right">{estimateKg(row.wet.afterKg)}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function facts(row: HistoryRow, timeZone: string) {
  const { entry, replaces } = row;
  const recordedLater = entry.recordedAt.slice(0, 16) !== entry.occurredAt.slice(0, 16);
  const batches = entry.allocations.map((allocation) => allocation.code);
  return [
    ...(batches.length > 0 ? [{ label: batches.length === 1 ? "Batch" : "Batches", value: batches.join(", ") }] : []),
    ...(entry.moisturePercent !== null ? [{ label: "Moisture", value: formatMoisturePercent(entry.moisturePercent) }] : []),
    ...(replaces ? [{ label: "Replaces", value: `${entryAmount(replaces, row.kind, formatMassKg)}, ${formatFacilityDateTime(replaces.occurredAt, timeZone)}` }] : []),
    ...(entry.reason && entry.kind !== "intake" ? [{ label: replaces ? "Why corrected" : "Reason", value: entry.reason }] : []),
    { label: "Recorded", value: `${recordedLater ? formatFacilityDateTime(entry.recordedAt, timeZone) : "At the time"}${entry.actorName ? ` by ${entry.actorName}` : ""}` },
  ];
}

export function HistoryEntry({ row, defaultOpen, timeZone, facilityId, onEdit }: {
  row: HistoryRow;
  defaultOpen: boolean;
  timeZone: string;
  facilityId: string;
  onEdit: (entry: OutputStockHistoryEntry) => void;
}) {
  const { entry, status } = row;
  const struck = status !== "counts";
  const subject = `${outputStockEventLabel(row.kind).toLowerCase()} on ${formatFacilityDateTime(entry.occurredAt, timeZone)}`;
  return (
    <details id={`output-movement-${entry.id}`} open={defaultOpen} className={`group ${RULE}`}>
      <summary className="grid min-h-44 cursor-pointer list-none grid-cols-[40px_minmax(0,1fr)_14px] items-start gap-8 py-10 hover:bg-[var(--clr-dark-purple-5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] [&::-webkit-details-marker]:hidden">
        <span className={`pt-2 body-caption tabular-nums ${MUTED}`}>{formatFacilityTime(new Date(entry.occurredAt), timeZone, TIME_FORMAT)}</span>
        <span className="flex flex-wrap items-center gap-6 body-small font-medium tabular-nums">
          <span className={struck ? `line-through ${MUTED}` : undefined}>{entrySentence(row, formatMassKg)}</span>
          {struck && <StockChip>{status === "replaced" ? "Replaced" : "Reversed"}</StockChip>}
        </span>
        <CaretDownIcon size={CARET_ICON_PX} aria-hidden="true" className={`mt-4 ${MUTED} transition-transform group-open:rotate-180 motion-reduce:transition-none`} />
      </summary>
      <div className="flex flex-col gap-10 pb-16 sm:pl-48">
        {struck && (
          <p className={`body-caption ${SECONDARY}`}>
            {row.replacedBy ? `Replaced by the correction recorded ${formatFacilityDateTime(row.replacedBy.recordedAt, timeZone)}.` : "Reversed."} It no longer counts toward the stock.
          </p>
        )}
        <PartsTable row={row} subject={subject} />
        {row.moistureEntry?.moistureReset && <MoistureResetChange reset={row.moistureEntry.moistureReset} />}
        <LedgerFacts facts={facts(row, timeZone)} />
        {row.kind === "loss" && !struck && (entry.editLockedReason === null
          ? <Button type="button" variant="noOutline" className="self-start" onClick={() => onEdit(entry)}>Edit</Button>
          : entry.editLockedReason ? <Notice tone="info">{entry.editLockedReason}</Notice> : null)}
        <StockSourceLink source={entry.source} facilityId={facilityId} />
      </div>
    </details>
  );
}
