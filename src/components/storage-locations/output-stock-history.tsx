"use client";

import { FormDetailProvider, FormDetailControl } from "@/components/forms/form-detail-context";
import { Button } from "@/components/ui";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { useOutputStockHistory } from "@/hooks/use-output-stock";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatDate, formatDateTime, formatMassKg } from "@/lib/format-utils";
import { outputStockEventLabel } from "@/lib/output-stock/labels";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import type { OutputStockHistoryEntry } from "@/types/output-stock";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { useState } from "react";
import { OutputStockForm } from "./output-stock-form";
import { OutputStockAllocations } from "./output-stock-preview";

export function OutputStockHistory({ storageLocationId, facilityId, movementId, triggerLabel = "More info" }: { storageLocationId: string; facilityId: string; movementId?: string; triggerLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [original, setOriginal] = useState<OutputStockHistoryEntry>();
  const history = useOutputStockHistory(storageLocationId, open);
  const correctedIds = new Set(history.data?.filter(entry => entry.kind === "reversal").map(entry => entry.correctsMovementId));
  const originalKind = (entry: OutputStockHistoryEntry): string => entry.eventKind ?? (entry.correctsMovementId ? originalKind(history.data?.find(item => item.id === entry.correctsMovementId) ?? { ...entry, correctsMovementId: null }) : entry.kind);
  return <>
    <Button variant="default" onClick={() => setOpen(true)}>{triggerLabel}</Button>
    <Modal isOpen={open} onClose={() => { setOpen(false); setOriginal(undefined); }} ariaLabel="Stock history" width="lg">
      <FormDetailProvider scope={`${open}:${original?.id}`} enabled={!!original}>
      <div className="space-y-20">
        <div className="flex items-center justify-between gap-12 pr-24"><h3 className="title-heading-3 min-w-0 truncate">Stock history</h3><FormDetailControl /></div>
        <p className="body-small">Recorded wet masses and moisture describe individual measurements. Current wet stock is an estimate conditional on moisture. Delivery moisture does not update a pile measurement.</p>
        {original ? <OutputStockForm storageLocationId={storageLocationId} facilityId={facilityId} kind={originalKind(original) === "count" ? "count" : originalKind(original) === "delivery" ? "delivery" : "loss"} original={original} onCancel={() => setOriginal(undefined)} onRecorded={() => setOriginal(undefined)} /> : <>
          {history.isLoading && <p role="status">Loading stock history...</p>}
          {history.error && <p role="alert">{history.error.message}</p>}
          {history.data?.length === 0 && <EmptyState icon={<ClockCounterClockwiseIcon size={32} />} title="No stock history" description="Recorded movements will appear here." padding="sm" />}
          {history.data?.toReversed().filter(entry => !movementId || entry.id === movementId).map(entry => <article id={`output-movement-${entry.id}`} key={entry.id} className="space-y-8 border-t border-[var(--color-border-tertiary)] pt-16">
            <h4 className="body-small font-semibold">{outputStockEventLabel(entry.kind)}{entry.correctsMovementId ? `, corrects ${history.data?.find(original => original.id === entry.correctsMovementId)?.reason ?? "a previous entry"}` : ", original entry"}</h4>
            <p className="body-medium">{formatMassKg(entry.wetMassKg)} measured wet at {formatMoisturePercent(entry.moisturePercent)} moisture</p>
            <p className="body-caption">{formatMassKg(entry.dryMassKg)} dry biochar effect. Before {formatMassKg(entry.beforeDryKg)}; after {formatMassKg(entry.afterDryKg)}.</p>
            <p className="body-caption">Physical date {formatDate(entry.physicalDate)}. Recorded {formatDateTime(entry.recordedAt)} by {entry.actorName ?? MISSING_VALUE.notRecorded}.</p>
            <p className="body-small">{entry.reason}</p>
            <OutputStockAllocations allocations={entry.allocations} />
            {entry.kind !== "reversal" && !correctedIds.has(entry.id) && ["loss", "count", "delivery"].includes(originalKind(entry)) && <Button variant="default" onClick={() => setOriginal(entry)}>Correct entry</Button>}
          </article>)}
        </>}
      </div>
      </FormDetailProvider>
    </Modal>
  </>;
}
