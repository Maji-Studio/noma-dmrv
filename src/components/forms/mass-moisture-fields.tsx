/**
 * The canonical wet-mass + moisture capture block.
 *
 * Six forms used to hand-roll this pair — each with its own label wording
 * ("Moisture Content (%)" / "Moisture (%)" / "Biochar Moisture (%)"), its own
 * range helper, and a grey "Dry: 237.5 kg" caption tucked under one of the two
 * inputs. The three quantities are one measurement, so they render as one
 * block: two inputs and, spanning both, the live `MoistureSplit` bar showing
 * what the entered numbers actually mean.
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
import { MoistureSplit } from "@/components/ui/moisture-split";
import type { CertFieldStatus } from "@/components/ui/certification-field-tag";
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
  /** Overrides the short always-visible cue rendered under the input. */
  helperText?: string;
  hint?: ReactNode;
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
  helperText = MOISTURE_RANGE_HELPER,
  hint = MOISTURE_BASIS_HINT,
  certifyRequired,
  certifyStatus,
  materialLabel,
  step = STORED_PERCENT_INPUT_STEP,
}: MassMoistureInputProps & { materialLabel?: string }) {
  return (
    <FormField
      id={id}
      label={label ?? qualifyMassLabel(MOISTURE_FIELD_LABEL, materialLabel)}
      error={error}
      warning={warning}
      helperText={helperText}
      hint={hint}
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
  moisture: MassMoistureInputProps;
  /** Watched wet-mass value driving the live split. */
  wetMassKg: unknown;
  /** Watched moisture value driving the live split. */
  moisturePercent: unknown;
  /** Watched water added after the recorded wet mass and moisture measurement. */
  addedWaterKg?: unknown;
  /** Added-water input (and any companion fields) rendered after the base measurements and before the chart. */
  addedWaterField?: ReactNode;
  /** Qualifies both labels and the split's dry-mass label ("Biochar", "Feedstock"). */
  materialLabel?: string;
  /** Overrides the wet figure label without changing the input label. */
  wetSplitLabel?: string;
  /** Overrides the dry figure label without changing the input label. */
  drySplitLabel?: string;
  /** Extra content rendered inside the split panel, below the bar. */
  splitFooter?: ReactNode;
}

/**
 * Wet mass and moisture side by side, with the derived split spanning both.
 * The split panel is framed so it reads as output rather than another input.
 */
export function MassMoistureFields({
  wet,
  moisture,
  wetMassKg,
  moisturePercent,
  addedWaterKg,
  addedWaterField,
  materialLabel,
  wetSplitLabel,
  drySplitLabel,
  splitFooter,
}: MassMoistureFieldsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
      <WetMassField {...wet} materialLabel={materialLabel} />
      <MoistureField {...moisture} materialLabel={materialLabel} />
      {addedWaterField && (
        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-x-16">
          {addedWaterField}
        </div>
      )}
      <div
        data-testid="mass-moisture-split"
        className="md:col-span-2 border-l-2 border-[var(--color-border-primary)] bg-[var(--color-background-medium)] px-16 py-12"
      >
        <MoistureSplit
          wetMassKg={parseWatchedNumber(wetMassKg)}
          moisturePercent={parseWatchedNumber(moisturePercent)}
          addedWaterKg={parseWatchedNumber(addedWaterKg)}
          materialLabel={materialLabel}
          wetLabel={wetSplitLabel}
          dryLabel={drySplitLabel}
        />
        {splitFooter}
      </div>
    </div>
  );
}
