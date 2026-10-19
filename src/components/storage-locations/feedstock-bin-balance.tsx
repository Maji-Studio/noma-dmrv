/**
 * A feedstock bin's stock card and history, the same card and ledger the
 * output bins use. Saved run draws keep their batch shares; draws without
 * batch records are estimated pro rata. The pile is one vessel with
 * the estimated water above its solids. Wet mass is the bin's own stock; dry solids are an
 * estimate from the batches' intake moisture.
 */
"use client";

import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { useState, type ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { InfoHint } from "@/components/ui/tooltip";
import { useFeedstockBinStock } from "@/hooks/use-bin-movements";
import { useFacilityClock } from "@/hooks/use-facility-context";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatFacilityDateTime, formatFacilityDay, formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import { LOST_MASS_LABEL } from "@/lib/output-stock/labels";
import type { FeedstockLedgerEntry } from "@/types/feedstock-bin-ledger";
import { CardTextButton, StockCard, StockChartCard } from "./stock-card";
import { LedgerDayHeader } from "./stock-ledger";
import { FEEDSTOCK_ENTRY_LABELS, FeedstockLedgerRow } from "./feedstock-ledger-row";
import { FeedstockLossDeleteDialog } from "./feedstock-loss-delete-dialog";
import { FeedstockLossForm } from "./feedstock-loss-form";
import { FormDialog } from "@/components/ui/form-dialog";
import { StockLevelChart, type StockLevelPoint } from "./stock-level-chart";
import { MixPileBay, type PileBand } from "./sub-bin-bays";

const ICON_PX = 16;
const EMPTY_ICON_PX = 32;
const PERCENT = 100;
const CARD_HINT = "Wet stock is what was received, minus production runs, product ingredients and lost mass. Run draws keep their saved batch shares. Other draws are estimated in proportion to what remains. Dry solids are an estimate from the batches' intake moisture.";
const HISTORY_HINT = "Every entry that moved feedstock in or out of this bin, with the wet stock left after it.";

/** The bin's level after each entry: estimated dry solids, with the rest of the wet stock as water. */
function feedstockStockPoints(entries: readonly FeedstockLedgerEntry[]): StockLevelPoint[] {
  const firstIntake = entries.findIndex(entry => entry.kind === "intake");
  const stocked = firstIntake < 0 ? [] : entries.slice(firstIntake);
  if (stocked.some(entry => entry.estimatedDryKg === null)) return [];
  return stocked.map((entry) => ({
    t: Date.parse(entry.occurredAt),
    dryKg: entry.estimatedDryKg!,
    waterKg: entry.estimatedDryKg === null ? null : Math.max(entry.afterWetKg - entry.estimatedDryKg, 0),
    label: FEEDSTOCK_ENTRY_LABELS[entry.kind],
  }));
}

function FeedstockStockHistory({ storageLocationId, facilityId, moisturePercent, renderTrigger }: {
  storageLocationId: string;
  facilityId: string;
  /** The pile's estimated moisture now, for the Lost mass edit form. */
  moisturePercent: number | null;
  renderTrigger: (open: () => void, icon: ReactNode) => ReactNode;
}) {
  const clock = useFacilityClock(facilityId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FeedstockLedgerEntry | null>(null);
  const [deleting, setDeleting] = useState<FeedstockLedgerEntry | null>(null);
  const stock = useFeedstockBinStock(storageLocationId);
  const entries = stock.data?.entries ?? [];
  const timeline = entries.toReversed();
  return <>
    {renderTrigger(() => setOpen(true), <ClockCounterClockwiseIcon size={ICON_PX} aria-hidden="true" />)}
    <Modal isOpen={open} onClose={() => setOpen(false)} ariaLabel="Stock history" width="md">
      <div className="space-y-20">
        <h3 className="flex min-w-0 items-center gap-6 pr-24 title-heading-3">
          <span className="truncate">Stock history</span>
          <InfoHint label="About stock history">{HISTORY_HINT}</InfoHint>
        </h3>
        {stock.isLoading && <p role="status" className="body-caption text-[var(--color-text-secondary)]">Loading the stock history</p>}
        {stock.error && <Notice tone="error">{stock.error.message}</Notice>}
        {stock.data && entries.length === 0 && <EmptyState icon={<ClockCounterClockwiseIcon size={EMPTY_ICON_PX} />} title="No stock history" description="Feedstock received into this bin will appear here." padding="sm" />}
        {timeline.length > 0 && <div className="tabular-nums">
          {timeline.map((entry, index) => {
            const day = formatFacilityDay(entry.occurredAt, clock.timeZone);
            const newDay = index === 0 || day !== formatFacilityDay(timeline[index - 1].occurredAt, clock.timeZone);
            return <div key={entry.id}>
              {newDay && <LedgerDayHeader day={day} afterLabel={index === 0 ? "Wet stock after" : undefined} />}
              <FeedstockLedgerRow entry={entry} corrected={entry.correctsMovementId ? entries.find(item => item.id === entry.correctsMovementId) : undefined}
                timeZone={clock.timeZone} facilityId={facilityId} onEdit={setEditing} onDelete={setDeleting} />
            </div>;
          })}
        </div>}
      </div>
    </Modal>
    <FormDialog isOpen={editing !== null} onClose={() => setEditing(null)} ariaLabel="Edit lost mass" width="md">
      <h3 className="title-heading-3 mb-20">{LOST_MASS_LABEL}</h3>
      {editing && <FeedstockLossForm key={editing.id} storageLocationId={storageLocationId} facilityId={facilityId} correction={editing}
        availableKg={stock.data?.currentWetKg ?? null} moisturePercent={moisturePercent}
        onCancel={() => setEditing(null)} onRecorded={() => setEditing(null)} />}
    </FormDialog>
    {deleting && <FeedstockLossDeleteDialog key={deleting.id} entry={deleting} storageLocationId={storageLocationId} timeZone={clock.timeZone} onClose={() => setDeleting(null)} />}
  </>;
}

export function FeedstockBinBalance({ storageLocationId, facilityId, capacityKg, onAdjust }: {
  storageLocationId: string;
  facilityId: string;
  capacityKg: number | null;
  onAdjust?: () => void;
}) {
  const stock = useFeedstockBinStock(storageLocationId);
  const clock = useFacilityClock(facilityId);
  const points = feedstockStockPoints(stock.data?.entries ?? []);
  const currentWetKg = stock.data?.currentWetKg ?? 0;
  const estimatedDryKg = stock.data?.entries.at(-1)?.estimatedDryKg ?? (stock.data?.currentWetKg === 0 ? 0 : null);
  const estimatedMoisturePercent = currentWetKg > 0 && estimatedDryKg !== null ? Math.max(0, (currentWetKg - estimatedDryKg) / currentWetKg * PERCENT) : null;
  const waterKg = estimatedDryKg === null ? null : Math.max(currentWetKg - estimatedDryKg, 0);
  const bands: PileBand[] = (stock.data?.batches ?? []).filter((batch) => batch.wetKg > 0).map((batch) => ({ label: batch.code, kg: estimatedDryKg === null ? batch.wetKg : batch.dryKg ?? 0, details: [
    { label: "In the pile now", value: `${formatMassKg(batch.wetKg)} wet` },
    { label: "Share of the pile", value: currentWetKg > 0 ? `${Math.round((batch.wetKg / currentWetKg) * PERCENT)}%` : MISSING_VALUE.notAvailable },
    { label: "Received", value: `${formatMassKg(batch.intakeWetKg)} wet` },
    { label: "Moisture at intake", value: batch.moisturePercent === null ? MISSING_VALUE.notAvailable : formatMoisturePercent(batch.moisturePercent) },
    { label: "Received on", value: formatFacilityDateTime(batch.receivedAt, clock.timeZone) },
  ] }));
  if (waterKg !== null && waterKg > 0) bands.push({ label: "Water, estimated", kg: waterKg, category: "existing-water", details: [
    { label: "Water, estimated", value: formatMassKg(waterKg) },
    { label: "Moisture", value: formatMoisturePercent(estimatedMoisturePercent) },
  ] });
  return <div className="flex flex-col gap-16">
    <StockCard
      title="Stock"
      hint={CARD_HINT}
      status={<>
        {stock.isLoading && <p role="status" className="body-caption">Loading stock...</p>}
        {stock.error && <Notice tone="error">{stock.error.message}</Notice>}
      </>}
      figure={stock.data && <>
        {formatMassKg(stock.data.currentWetKg)} wet
        {capacityKg != null && <span className="body-small text-[var(--color-text-tertiary)]"> of {formatMassKg(capacityKg)}</span>}
      </>}
      caption={stock.data && <>
        {estimatedDryKg === null ? `Dry solids: ${MISSING_VALUE.notAvailable}` : `≈ ${formatMassKg(estimatedDryKg)} dry solids`} · {estimatedMoisturePercent === null ? MISSING_VALUE.notAvailable : formatMoisturePercent(estimatedMoisturePercent)} moisture
      </>}
      onAdjust={onAdjust}
    >
      {stock.data && bands.length === 0 && <EmptyState icon={null} title="No stock in this bin" padding="sm" />}
      {bands.length > 0 && <MixPileBay label={estimatedDryKg === null ? "Wet feedstock by batch, moisture unknown" : "Feedstock solids by batch"} bands={bands} capacityKg={capacityKg} />}
    </StockCard>
    <StockChartCard history={<FeedstockStockHistory storageLocationId={storageLocationId} facilityId={facilityId} moisturePercent={estimatedMoisturePercent}
      renderTrigger={(open, icon) => <CardTextButton icon={icon} onClick={open}>History</CardTextButton>} />}>
      {stock.error ? <Notice tone="error">{stock.error.message}</Notice> : stock.isLoading ? <p role="status" className="body-caption">Loading stock history</p> : points.length > 0 ? <StockLevelChart compact points={points} timeZone={clock.timeZone} now={stock.dataUpdatedAt} solidLabel="Dry solids, estimated" /> : undefined}
    </StockChartCard>
  </div>;
}
