/**
 * DryMassInput — a wet-mass number input that surfaces the derived dry mass.
 *
 * As soon as both a wet mass and a valid moisture % are present, the computed
 * dry mass appears as a muted note directly below the field ("Dry: 237.5 kg"),
 * styled like the form's other helper captions. It is display-only — the
 * authoritative dry mass is recomputed server-side — so it never enters the
 * form value; it's operator feedback that saves a second field and a separate
 * readout.
 *
 * Reuse anywhere a wet mass is captured alongside a moisture %: pass the watched
 * wet-mass and moisture values; register the field as usual.
 */
"use client";

import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { FormInput } from "./form-input";
import { deriveMassDryKg } from "@/lib/calculations/mass-dry";

const DRY_MASS_MAX_FRACTION_DIGITS = 1;

interface DryMassInputProps extends ComponentPropsWithoutRef<typeof FormInput> {
  /** Current wet-mass value (watched from RHF). */
  wetMassKg: unknown;
  /** Current moisture-% value (watched from RHF). */
  moisturePercent: unknown;
}

/** Derive dry mass only when both inputs are valid; otherwise null (no note). */
function deriveDryMass(wetMassKg: unknown, moisturePercent: unknown): number | null {
  if (
    typeof wetMassKg === "number" &&
    typeof moisturePercent === "number" &&
    wetMassKg >= 0 &&
    moisturePercent >= 0 &&
    moisturePercent <= 100
  ) {
    return deriveMassDryKg(wetMassKg, moisturePercent);
  }
  return null;
}

export const DryMassInput = forwardRef<HTMLInputElement, DryMassInputProps>(
  ({ wetMassKg, moisturePercent, className, ...props }, ref) => {
    const dry = deriveDryMass(wetMassKg, moisturePercent);

    return (
      <>
        <FormInput ref={ref} className={className} {...props} />
        {dry !== null && (
          <p className="body-caption text-[var(--color-text-tertiary)] mt-6">
            Dry:{" "}
            {dry.toLocaleString(undefined, {
              maximumFractionDigits: DRY_MASS_MAX_FRACTION_DIGITS,
            })}{" "}
            kg
          </p>
        )}
      </>
    );
  },
);

DryMassInput.displayName = "DryMassInput";
