/**
 * One line of a feedstock bin's stock history. A Lost mass entry that nothing
 * took stock out after can be edited or deleted from here; a corrected entry
 * stays in the list, struck through, beside the correction that names it.
 */
"use client";

import { Button } from "@/components/ui";
import { Notice } from "@/components/ui/notice";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatFacilityTime } from "@/lib/date-utils";
import { formatFacilityDateTime, formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import { LOST_MASS_LABEL, outputStockEventLabel } from "@/lib/output-stock/labels";
import type { FeedstockLedgerEntry } from "@/types/feedstock-bin-ledger";
import { LedgerBeforeAfter, LedgerFacts, LedgerLine } from "./stock-ledger";
import { StockSourceLink } from "./stock-source-link";

const TIME_FORMAT = "HH:mm";

export const FEEDSTOCK_ENTRY_LABELS: Record<FeedstockLedgerEntry["kind"], string> = {
  intake: outputStockEventLabel("intake"), run_draw: "Production run", ingredient_draw: "Product ingredient", loss: LOST_MASS_LABEL, count: "Stock count",
};
/** Icon per entry, from the shared stock-kind set. */
const ENTRY_ICONS: Record<FeedstockLedgerEntry["kind"], string> = {
  intake: "intake", run_draw: "production_draw", ingredient_draw: "production_draw", loss: "loss", count: "count",
};

function signedWet(kg: number | null): string {
  if (kg === null) return MISSING_VALUE.notAvailable;
  const sign = kg > 0 ? "+" : kg < 0 ? "−" : "";
  return `${sign}${formatMassKg(Math.abs(kg))} wet`;
}

function recordedBy(at: string, occurredAt: string | null, actorName: string | null, timeZone: string): string {
  const later = occurredAt === null || at.slice(0, 16) !== occurredAt.slice(0, 16);
  return `${later ? formatFacilityDateTime(at, timeZone) : "At the time"}${actorName ? ` by ${actorName}` : ""}`;
}

export function FeedstockLedgerRow({ entry, corrected, timeZone, facilityId, onEdit, onDelete }: {
  entry: FeedstockLedgerEntry;
  /** The Lost mass entry this one corrects, when it is a correction. */
  corrected?: FeedstockLedgerEntry;
  timeZone: string;
  facilityId: string;
  onEdit: (entry: FeedstockLedgerEntry) => void;
  onDelete: (entry: FeedstockLedgerEntry) => void;
}) {
  // A deleted product's ingredient draw and a corrected Lost mass entry both stay listed, struck through.
  const reversed = !!entry.reversed;
  const replaced = !!entry.reversedBy?.replacementId;
  const chips = [...(entry.reversedBy ? [replaced ? "Replaced" : "Reversed"] : []), ...(corrected ? ["Correction"] : [])];
  // The times show under Original and Corrected only when the correction moved the entry.
  const movedTime = !!corrected && corrected.occurredAt !== entry.occurredAt;
  const amount = entry.kind === "count" && entry.countedWetKg !== null ? `${formatMassKg(entry.countedWetKg)} wet` : signedWet(entry.wetDeltaKg);
  return (
    <LedgerLine id={`feedstock-entry-${entry.id}`} time={formatFacilityTime(new Date(entry.occurredAt), timeZone, TIME_FORMAT)}
      iconKind={ENTRY_ICONS[entry.kind]} label={FEEDSTOCK_ENTRY_LABELS[entry.kind]} chips={chips} note={entry.reason || entry.code || undefined}
      amount={amount} after={formatMassKg(entry.afterWetKg)} struck={reversed}>
      {entry.reversedBy && (
        <p className="body-caption text-[var(--color-text-secondary)]">
          {replaced ? `Replaced by the correction recorded ${formatFacilityDateTime(entry.reversedBy.recordedAt, timeZone)}.` : `Deleted ${formatFacilityDateTime(entry.reversedBy.recordedAt, timeZone)}${entry.reversedBy.actorName ? ` by ${entry.reversedBy.actorName}` : ""}.`} It no longer counts toward the stock.
        </p>
      )}
      <StockSourceLink facilityId={facilityId} source={entry.sourceId && (entry.kind === "intake" || entry.kind === "run_draw" || entry.kind === "ingredient_draw")
        ? { entity: entry.kind === "intake" ? "feedstock" : entry.kind === "run_draw" ? "productionRun" : "biocharProduct", id: entry.sourceId } : null} />
      {!entry.reversedBy && <LedgerBeforeAfter before={`${formatMassKg(entry.beforeWetKg)} wet`} after={`${formatMassKg(entry.afterWetKg)} wet`} />}
      {corrected && (
        <LedgerBeforeAfter title={`Corrects the lost mass from ${formatFacilityDateTime(corrected.occurredAt, timeZone)}`} labels={["Original", "Corrected"]}
          before={{ value: signedWet(corrected.wetDeltaKg), caption: movedTime ? formatFacilityDateTime(corrected.occurredAt, timeZone) : undefined }}
          after={{ value: signedWet(entry.wetDeltaKg), caption: movedTime ? formatFacilityDateTime(entry.occurredAt, timeZone) : undefined }} />
      )}
      <LedgerFacts facts={[
        ...(entry.code ? [{ label: entry.kind === "intake" ? "Batch" : entry.kind === "run_draw" ? "Run" : "Product", value: entry.code }] : []),
        ...(entry.moisturePercent !== null ? [{ label: "Moisture", value: formatMoisturePercent(entry.moisturePercent) }] : []),
        ...(entry.kind === "count" ? [{ label: "Change", value: signedWet(entry.wetDeltaKg) }] : []),
        ...(entry.reason ? [{ label: corrected ? "Why corrected" : "Reason", value: entry.reason }] : []),
        ...(entry.reversedBy && !replaced ? [{ label: "Why deleted", value: entry.reversedBy.reason }] : []),
        { label: "Recorded", value: recordedBy(entry.recordedAt, entry.occurredAt, entry.actorName, timeZone) },
      ]} />
      {entry.kind === "loss" && !reversed && (entry.editLockedReason === null
        ? <div className="flex flex-wrap gap-8">
            <Button type="button" variant="noOutline" onClick={() => onEdit(entry)}>Edit</Button>
            <Button type="button" variant="noOutline" onClick={() => onDelete(entry)}>Delete</Button>
          </div>
        : entry.editLockedReason ? <Notice tone="info">{entry.editLockedReason}</Notice> : null)}
    </LedgerLine>
  );
}
