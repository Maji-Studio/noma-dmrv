/**
 * Where a split-bin load came from, on the form itself: one collapsed line
 * ("Oldest first · Change") and, under it, a moisture reading per sub-bin the
 * load reaches. A row appears as the weight grows past the sub-bin before it.
 * Change opens the dialog that ticks and orders sub-bins; readings never go
 * there, so every required field stays visible and validated on the form.
 */
"use client";

import { useState } from "react";
import { FormField, FormInput } from "@/components/forms";
import { Button } from "@/components/ui";
import type { SubBinDraw } from "@/hooks/use-sub-bin-draw";
import { MOISTURE_BASIS_HINT } from "@/lib/mass-moisture";
import { moistureReadingGuidance, outputMoistureFieldEstimate } from "@/lib/output-stock/moisture-guidance";
import type { SubBinRow } from "@/lib/output-stock/sub-bin-draw";
import { STORED_PERCENT_INPUT_STEP } from "@/schemas/helpers";
import type { OutputSubBin } from "@/types/output-stock";
import { StockNotice } from "./stock-figures";
import { formatWetEstimate } from "./stock-preview-shared";
import { SubBinOrderDialog } from "./sub-bin-order-dialog";

const PERCENT_MAX = 100;

interface Props {
  draw: SubBinDraw;
  timeZone: string;
  /** Prefixes each reading input's id, so two draws on one page stay distinct. */
  idPrefix: string;
  disabled?: boolean;
  /** Set once the operator tries to save, so empty readings then say so. */
  showErrors?: boolean;
}

/** What a row draws, beside its label. Silent for a one-row load: the load weight already says it. */
function rowAside(row: SubBinRow, rowCount: number): string | undefined {
  if (row.wetKg === null) return undefined;
  if (row.emptied) return `Emptied, ≈ ${formatWetEstimate(row.wetKg)} kg wet`;
  return rowCount > 1 ? `Takes ≈ ${formatWetEstimate(row.wetKg)} kg wet` : undefined;
}

function readingError(raw: string | undefined, showErrors: boolean): string | undefined {
  if (raw === undefined || raw.trim() === "") return showErrors ? "Enter the measured moisture." : undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value >= PERCENT_MAX) return "Enter a moisture from 0 to less than 100%.";
  return undefined;
}

export function SubBinDrawField({ draw, timeZone, idPrefix, disabled, showErrors = false }: Props) {
  const [changing, setChanging] = useState(false);
  const byId = new Map(draw.subBins.map(subBin => [subBin.layerId, subBin]));
  // With one sub-bin there is no order to choose: the line names it.
  const summary = draw.subBins.length === 1 ? draw.subBins[0].code : draw.order ? draw.ordered.map(s => s.code).join(" → ") : "Oldest first";
  return (
    <div className="space-y-16">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <span className="body-small font-medium text-[var(--color-text-secondary)]">Load from</span>
        <span className="body-small">{summary}</span>
        {draw.subBins.length > 1 && (
          <Button type="button" size="small" variant="noOutline" disabled={disabled} onClick={() => setChanging(true)} aria-label="Change the sub-bins in this load">
            Change
          </Button>
        )}
      </div>
      {/* The refusal sits next to the Change control that fixes it. */}
      {draw.untickCode && (
        <StockNotice tone="error" role="alert">
          This load is used up before it reaches {draw.untickCode}. Untick it under Change.
        </StockNotice>
      )}
      {draw.needsTick && (
        <StockNotice tone="error" role="alert">
          This load is more than the ticked sub-bins hold. Tick another sub-bin under Change.
        </StockNotice>
      )}
      {/* Readings line up under the wet mass field that drives them. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-20">
        {draw.plan.rows.map((row) => {
          const subBin = byId.get(row.layerId);
          return subBin ? (
            <ReadingRow
              key={row.layerId}
              id={`${idPrefix}-moisture-${row.layerId}`}
              subBin={subBin}
              aside={rowAside(row, draw.plan.rows.length)}
              raw={draw.readings[row.layerId]}
              onChange={(raw) => draw.setReading(row.layerId, raw)}
              timeZone={timeZone}
              disabled={disabled}
              showErrors={showErrors}
            />
          ) : null;
        })}
      </div>
      <SubBinOrderDialog
        isOpen={changing}
        onClose={() => setChanging(false)}
        subBins={draw.subBins}
        order={draw.order}
        onApply={draw.setOrder}
        timeZone={timeZone}
      />
    </div>
  );
}

/** One sub-bin's reading: required, never prefilled, with its own estimate as the hint. */
function ReadingRow({ id, subBin, aside, raw, onChange, timeZone, disabled, showErrors }: {
  id: string;
  subBin: OutputSubBin;
  aside?: string;
  raw: string | undefined;
  onChange: (raw: string) => void;
  timeZone: string;
  disabled?: boolean;
  showErrors: boolean;
}) {
  const estimate = outputMoistureFieldEstimate({ moisturePercent: subBin.moisturePercent, wetKg: subBin.wetEstimateKg, basis: subBin.basis }, timeZone);
  const error = readingError(raw, showErrors);
  const guidance = moistureReadingGuidance(estimate, raw === undefined || raw.trim() === "" ? null : Number(raw));
  return (
    <div className="sm:col-start-1">
      <FormField
        id={id}
        label={`${subBin.code} moisture (%)`}
        required
        error={error}
        warning={guidance.warning}
        helperText={guidance.helperText}
        hint={guidance.basisText ? <>{guidance.basisText} {MOISTURE_BASIS_HINT}</> : MOISTURE_BASIS_HINT}
        aside={aside}
      >
        <FormInput
          id={id}
          type="number"
          inputMode="decimal"
          step={STORED_PERCENT_INPUT_STEP}
          min="0"
          max={String(PERCENT_MAX)}
          disabled={disabled}
          error={!!error}
          value={raw ?? ""}
          onChange={(event) => onChange(event.target.value)}
        />
      </FormField>
    </div>
  );
}
