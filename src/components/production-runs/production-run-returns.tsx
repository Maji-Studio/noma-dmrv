/**
 * A Failed run's Leftover material section: how much dry material the run
 * consumed, returned and can still return, the returns so far, and the action
 * to return more. Rest state: the figures and the first three returns; the
 * explanation sits behind the section's (i).
 */
"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { MASS_KG_STORAGE_DECIMALS } from "@/config/numeric-storage";
import { EmptyState } from "@/components/ui/empty-state";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { Notice } from "@/components/ui/notice";
import { INLINE_HIT_AREA } from "@/components/ui/touch-target";
import { FormDialog } from "@/components/ui/form-dialog";
import { Button } from "@/components/ui";
import { TextAction } from "@/components/ui/text-action";
import { ChangeBlock } from "@/components/storage-locations/feedstock-loss-change";
import { StockChip } from "@/components/storage-locations/stock-figures";
import { useFacilityClock } from "@/hooks/use-facility-context";
import { useProductionRunMaterialBalance, useProductionRunReturnEligibility, useProductionRunReturns } from "@/hooks/use-production-run-returns";
import { formatFacilityDateTime, formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import { reversalCaption } from "@/lib/loss-correction-messages";
import { recordHref } from "@/lib/record-links";
import type { ProductionRunReturnRow } from "@/data-access/production-run-returns/view";
import {
  BALANCE_FAILED, BLOCKER_FULLY_RETURNED_NEXT, CONVERSION_LOSS_HINT, CONVERSION_LOSS_LABEL, ELIGIBILITY_FAILED, NOTHING_RETURNED, RETURN_ACTION_LABEL,
  RETURN_DRY_CAPTION, RETURN_FIGURE_LABELS, RETURN_ROW_REST, RETURNS_LOADING,
} from "./production-run-return-copy";
import { ProductionRunReturnForm } from "./production-run-return-form";
import { ProductionRunReturnReverseDialog } from "./production-run-return-reverse-dialog";

const MUTED = "text-[var(--color-text-secondary)]";
const DRY_CAPTION_SEPARATOR = ", ";
const massKg = (kg: number | null) => formatMassKg(kg, { digits: MASS_KG_STORAGE_DECIMALS });

function ReturnRow({ row, facilityId, timeZone, onCorrect, onReverse }: {
  row: ProductionRunReturnRow;
  facilityId: string;
  timeZone: string;
  onCorrect?: () => void;
  onReverse?: () => void;
}) {
  const struck = row.state !== "active";
  const chips = [...(row.state === "reversed" ? ["Reversed"] : row.state === "replaced" ? ["Replaced"] : []), ...(row.replacesId ? ["Correction"] : [])];
  const binName = row.destinationName ?? row.destinationCode ?? "Bin";
  return (
    <li className="flex flex-col gap-4 py-12 [border-top:var(--row-divider)]">
      <div className="flex items-start justify-between gap-12">
        <div className="flex min-w-0 flex-col">
          <span className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <Link className={`body-small font-medium underline underline-offset-4 ${INLINE_HIT_AREA}`} href={recordHref("storageBin", row.storageLocationId, { facilityId })}>{binName}</Link>
            {chips.map((chip) => <StockChip key={chip}>{chip}</StockChip>)}
          </span>
          <span className={`body-caption ${MUTED}`}>
            {formatMoisturePercent(row.moisturePercent)} moisture{DRY_CAPTION_SEPARATOR}{massKg(row.dryMassKg)} dry
          </span>
        </div>
        <span className={`shrink-0 body-small font-medium tabular-nums ${struck ? "line-through text-[var(--color-text-tertiary)]" : ""}`}>
          {massKg(row.wetMassKg)} wet mass
        </span>
      </div>
      <p className={`body-caption ${MUTED}`}>{formatFacilityDateTime(row.occurredAt, timeZone)}{row.actorName ? ` by ${row.actorName}` : ""}</p>
      {row.reversal && (
        <p className={`body-caption ${MUTED}`}>
          {reversalCaption({ recordedAt: row.reversal.recordedAt, actorName: row.reversal.actorName, replaced: row.state === "replaced", returnEntry: true }, timeZone)}
          <br />
          {row.state === "replaced" ? "Why corrected" : "Why reversed"}: {row.reversal.reason}
        </p>
      )}
      {row.state === "active" && row.editLockedReason ? <Notice tone="info">{row.editLockedReason}</Notice> : (onCorrect || onReverse) && row.state === "active" && (
        <div className="flex flex-wrap gap-x-16">
          {onCorrect && <TextAction type="button" onClick={onCorrect}>Correct</TextAction>}
          {onReverse && <TextAction type="button" onClick={onReverse}>Reverse</TextAction>}
        </div>
      )}
    </li>
  );
}

export function ProductionRunReturns({ runId, facilityId, feedstockWetMassKg, readOnly = false }: {
  runId: string;
  facilityId: string;
  /** Wet feedstock the run drew, for the first figure. */
  feedstockWetMassKg: number | null;
  readOnly?: boolean;
}) {
  const clock = useFacilityClock(facilityId);
  const returns = useProductionRunReturns(runId);
  const eligibility = useProductionRunReturnEligibility(runId);
  const balance = useProductionRunMaterialBalance(runId);
  const [showAll, setShowAll] = useState(false);
  const [recording, setRecording] = useState(false);
  const [correcting, setCorrecting] = useState<ProductionRunReturnRow | null>(null);
  const [reversing, setReversing] = useState<ProductionRunReturnRow | null>(null);
  const returnTitleId = useId();

  if (returns.isLoading || eligibility.isLoading || balance.isLoading) {
    return <div role="status" aria-label={RETURNS_LOADING} className="flex flex-col gap-8"><Skeleton className="h-[48px]" width="100%" /><Skeleton className="h-[48px]" width="100%" /></div>;
  }
  if (returns.error || eligibility.error || !eligibility.data) return <Notice tone="error">{ELIGIBILITY_FAILED}</Notice>;

  const rows = returns.data ?? [];
  const active = rows.filter((row) => row.state === "active");
  const check = eligibility.data;
  const figures = balance.data?.balance;
  const returnedWetKg = active.reduce((sum, row) => sum + row.wetMassKg, 0);
  // At zero the figure already says nothing can return; only the next step is left to say.
  const fullyReturned = check.code === "ineligible" && check.remainingDryKg === 0;
  const locked = check.code === "certification_locked";
  const canWrite = !readOnly && !locked;
  const feedstockTypeId = check.returnedFeedstockTypeId;
  const remainingDryKg = check.remainingDryKg;
  const canCorrect = canWrite && feedstockTypeId !== null && remainingDryKg !== null;
  const shown = showAll ? rows : rows.slice(0, RETURN_ROW_REST);

  return (
    <div className="flex flex-col gap-16">
      {balance.error ? <Notice tone="error">{BALANCE_FAILED}</Notice> : figures && (
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
          <ChangeBlock label={RETURN_FIGURE_LABELS.fedIn} figure={massKg(feedstockWetMassKg)} caption={`wet mass${DRY_CAPTION_SEPARATOR}${massKg(figures.consumedDryKg)} dry`} />
          <ChangeBlock label={RETURN_FIGURE_LABELS.returned} figure={massKg(returnedWetKg)} caption={`wet mass${DRY_CAPTION_SEPARATOR}${massKg(figures.activeReturnedDryKg)} dry`} />
          <ChangeBlock label={CONVERSION_LOSS_LABEL} figure={massKg(figures.conversionLossDryKg)} caption={RETURN_DRY_CAPTION.toLowerCase()}
            labelAddon={<ExplanationInfo title={CONVERSION_LOSS_LABEL} hint={CONVERSION_LOSS_HINT} />} />
        </div>
      )}
      {!check.eligible && check.blocker && (canWrite || !fullyReturned) && (
        <Notice tone={fullyReturned ? "info" : "warning"}>{fullyReturned ? BLOCKER_FULLY_RETURNED_NEXT : check.blocker}</Notice>
      )}
      {rows.length === 0 ? <EmptyState padding="sm" icon={null} title={NOTHING_RETURNED} /> : (
        <div className="flex flex-col">
          <ul>
            {shown.map((row) => (
              <ReturnRow key={row.id} row={row} facilityId={facilityId} timeZone={clock.timeZone}
                onCorrect={canCorrect ? () => setCorrecting(row) : undefined} onReverse={canWrite ? () => setReversing(row) : undefined} />
            ))}
          </ul>
          {rows.length > RETURN_ROW_REST && (
            <TextAction type="button" aria-expanded={showAll} onClick={() => setShowAll((open) => !open)}>
              {showAll ? "Show fewer" : `Show all ${rows.length}`}
            </TextAction>
          )}
        </div>
      )}
      {check.eligible && canWrite && feedstockTypeId !== null && remainingDryKg !== null && (
        <div className="self-start">
          <Button type="button" variant="default" onClick={() => setRecording(true)}>{RETURN_ACTION_LABEL}</Button>
        </div>
      )}
      <FormDialog isOpen={recording || correcting !== null} onClose={() => { setRecording(false); setCorrecting(null); }}
        ariaLabel={correcting ? "Correct return" : RETURN_ACTION_LABEL} titleId={returnTitleId} width="md">
        <h3 id={returnTitleId} className="title-heading-3 mb-20">{correcting ? "Correct return" : RETURN_ACTION_LABEL}</h3>
        {feedstockTypeId !== null && remainingDryKg !== null && (
          <ProductionRunReturnForm key={correcting?.id ?? "new"} runId={runId} facilityId={facilityId} feedstockTypeId={feedstockTypeId}
            remainingDryKg={remainingDryKg} correction={correcting ?? undefined}
            onCancel={() => { setRecording(false); setCorrecting(null); }} onSaved={() => { setRecording(false); setCorrecting(null); }} />
        )}
      </FormDialog>
      {reversing && <ProductionRunReturnReverseDialog key={reversing.id} runId={runId} entry={reversing} timeZone={clock.timeZone} onClose={() => setReversing(null)} />}
    </div>
  );
}
