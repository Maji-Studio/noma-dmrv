/**
 * The canonical wet-mass + moisture capture block.
 *
 * Six forms used to hand-roll this pair — each with its own label wording
 * ("Moisture Content (%)" / "Moisture (%)" / "Biochar Moisture (%)"), its own
 * range helper, and a grey "Dry: 237.5 kg" caption tucked under one of the two
 * inputs. The three quantities are one measurement, so they render as one
 * block: two inputs and, spanning both, the live `MoistureSplit` bar showing
 * what the entered numbers actually mean. The bar carries no frame of its own;
 * it belongs to the inputs above it.
 *
 * `MassMoistureFields` is the pairing. `MoistureField` is for the forms that
 * capture a moisture reading with no wet mass beside it (lab samples), and
 * `WetMassField` for the reverse. All three take the caller's `register(...)`
 * result so schema-side coercion (`setValueAs`) stays with the form that owns
 * the field.
 *
 * Labels, hint copy and precision all come from `@/lib/mass-moisture`; pass
 * `materialLabel` when the mass needs qualifying ("Biochar", "Feedstock")
 * rather than rewriting the label.
 */
"use client";

import type { ReactNode } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { FormField } from "./form-field";
import { FormInput } from "./form-input";
import { DetailedOnly } from "./form-detail-context";
import { MoistureSplit } from "@/components/ui/moisture-split";
import type { CertFieldStatus } from "@/components/ui/certification-field-tag";
import { moistureReadingGuidance, type MoistureFieldEstimate } from "@/lib/output-stock/moisture-guidance";
import {
  MASS_KG_INPUT_STEP,
  STORED_PERCENT_INPUT_STEP,
} from "@/schemas/helpers";
import {
  MOISTURE_BASIS_HINT,
  MOISTURE_FIELD_LABEL,
  qualifyMassLabel,
  MOISTURE_RANGE_HELPER,
  parseWatchedNumber,
  WET_MASS_FIELD_LABEL,
} from "@/lib/mass-moisture";

const PERCENT_MIN = "0";
const PERCENT_MAX = "100";
const MASS_MIN = "0";

/** Shared shape for one of the two inputs — everything that legitimately varies per form. */
interface MassMoistureInputProps {
  id: string;
  /** Overrides the canonical label. Prefer `materialLabel` on the parent. */
  label?: string;
  registration: UseFormRegisterReturn;
  error?: string;
  warning?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Explanation added behind the ⓘ, after `hint`. */
  helperText?: string;
  hint?: ReactNode;
  /** Overrides the short visible line under the input (a limit or unit). */
  cue?: string;
  certifyRequired?: boolean;
  certifyStatus?: CertFieldStatus;
  /**
   * Overrides the storage-precision step. Pass `"any"` for columns backed by
   * `real` rather than the exact `numeric` families (lab sample readings), so
   * the input does not reject a precision the schema accepts.
   */
  step?: number | string;
}

/**
 * A stock reading: the estimate it is checked against, and the value as typed.
 * With an estimate the field shows it as its cue under the input, dates it
 * behind the ⓘ, and warns (never blocks) when the reading is far from it. The
 * estimate is never filled in: every reading is measured.
 */
interface MoistureReadingProps {
  estimate?: MoistureFieldEstimate | null;
  reading?: unknown;
}

/**
 * Moisture percentage input. Carries the wet-basis explainer on every instance —
 * "moisture content" is ambiguous between wet and dry basis in the biochar
 * literature, and this app is wet-basis throughout.
 */
export function MoistureField({
  id,
  label,
  registration,
  error,
  warning,
  required,
  disabled,
  placeholder = "e.g. 20",
  helperText,
  cue,
  hint = MOISTURE_BASIS_HINT,
  certifyRequired,
  certifyStatus,
  materialLabel,
  step = STORED_PERCENT_INPUT_STEP,
  estimate,
  reading,
}: MassMoistureInputProps & MoistureReadingProps & { materialLabel?: string }) {
  const guidance = estimate === undefined ? null : moistureReadingGuidance(estimate, parseWatchedNumber(reading));
  return (
    <FormField
      id={id}
      label={label ?? qualifyMassLabel(MOISTURE_FIELD_LABEL, materialLabel)}
      error={error}
      warning={guidance?.warning ?? warning}
      // The 0 to 100% range sits behind the ⓘ with the basis (Kenji, cue review 2026-09-30).
      helperText={[MOISTURE_RANGE_HELPER, helperText].filter(Boolean).join(" ")}
      cue={guidance?.cue ?? cue}
      hint={guidance?.basisText ? <>{guidance.basisText} {hint}</> : hint}
      required={required}
      certifyRequired={certifyRequired}
      certifyStatus={certifyStatus}
    >
      <FormInput
        id={id}
        type="number"
        step={step}
        min={PERCENT_MIN}
        max={PERCENT_MAX}
        placeholder={placeholder}
        disabled={disabled}
        error={!!error}
        {...registration}
      />
    </FormField>
  );
}

/** As-received mass input. The scale reading, before any moisture adjustment. */
export function WetMassField({
  id,
  label,
  registration,
  error,
  warning,
  required,
  disabled,
  placeholder = "e.g. 1000",
  helperText,
  cue,
  hint = "As-received weight, water included.",
  certifyRequired,
  certifyStatus,
  materialLabel,
  step = MASS_KG_INPUT_STEP,
}: MassMoistureInputProps & { materialLabel?: string }) {
  return (
    <FormField
      id={id}
      label={label ?? qualifyMassLabel(WET_MASS_FIELD_LABEL, materialLabel)}
      error={error}
      warning={warning}
      helperText={helperText}
      cue={cue}
      hint={hint}
      required={required}
      certifyRequired={certifyRequired}
      certifyStatus={certifyStatus}
    >
      <FormInput
        id={id}
        type="number"
        step={step}
        min={MASS_MIN}
        placeholder={placeholder}
        disabled={disabled}
        error={!!error}
        {...registration}
      />
    </FormField>
  );
}

interface MassMoistureFieldsProps {
  wet: MassMoistureInputProps;
  moisture: MassMoistureInputProps & MoistureReadingProps;
  /** Watched wet-mass value driving the live split. */
  wetMassKg: unknown;
  /** Watched moisture value driving the live split. */
  moisturePercent: unknown;
  /** Watched water added after the recorded wet mass and moisture measurement. */
  addedWaterKg?: unknown;
  /** Added-water input (and any companion fields) rendered after the base measurements and before the chart. */
  addedWaterField?: ReactNode;
  /**
   * Replaces the moisture input with per-sub-bin readings (a split-bin draw).
   * `moisturePercent` then carries the draw's overall moisture for the split.
   */
  readings?: ReactNode;
  /** Qualifies both labels and the split's dry-mass label ("Biochar", "Feedstock"). */
  materialLabel?: string;
  /** Overrides the wet figure label without changing the input label. */
  wetSplitLabel?: string;
  /** Overrides the dry figure label without changing the input label. */
  drySplitLabel?: string;
  /** Overrides the added-water summary's final-moisture label. */
  finalMoistureLabel?: string;
  /** Extra content rendered inside the split panel, below the bar. */
  splitFooter?: ReactNode;
}

/**
 * Wet mass and moisture side by side, with the derived split spanning both.
 *
 * The split is unframed on purpose: it is not a separate panel of output, it is
 * what the two inputs above it mean, so the bar and its key sit directly under
 * them and move as they change. `MoistureSplit` decides how much of the
 * calculation to show from the form detail level. Both levels draw the split
 * once wet mass or moisture has a value. Before that, the unresolved state is
 * explanation of what will appear, so only Detailed shows it.
 */
export function MassMoistureFields({
  wet,
  moisture,
  wetMassKg,
  moisturePercent,
  addedWaterKg,
  addedWaterField,
  readings,
  materialLabel,
  wetSplitLabel,
  drySplitLabel,
  finalMoistureLabel,
  splitFooter,
}: MassMoistureFieldsProps) {
  const wetKg = parseWatchedNumber(wetMassKg);
  const moistureValue = parseWatchedNumber(moisturePercent);
  const started = wetKg !== null || moistureValue !== null;
  const split = (
    <MoistureSplit
      wetMassKg={wetKg}
      moisturePercent={moistureValue}
      addedWaterKg={parseWatchedNumber(addedWaterKg)}
      materialLabel={materialLabel}
      wetLabel={wetSplitLabel}
      dryLabel={drySplitLabel}
      finalMoistureLabel={finalMoistureLabel}
    />
  );
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
      <WetMassField {...wet} materialLabel={materialLabel} />
      {readings ? <div className="md:col-span-2">{readings}</div> : <MoistureField {...moisture} materialLabel={materialLabel} />}
      {addedWaterField && (
        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-x-16">
          {addedWaterField}
        </div>
      )}
      {/* Hidden while nothing inside has content, so Simple adds no empty grid row. */}
      <div data-testid="mass-moisture-split" className="md:col-span-2 [&:not(:has(*:not(:empty)))]:hidden">
        <DetailedOnly unless={started}>{split}</DetailedOnly>
        {splitFooter}
      </div>
    </div>
  );
}
