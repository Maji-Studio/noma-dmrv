"use client";

import { useEffect, useRef } from "react";
import { Warning } from "@phosphor-icons/react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { FormField } from "./form-field";
import { FormInput } from "./form-input";
import { SectionLabel } from "./section-label";

const WEIGHBRIDGE_MISMATCH_TOLERANCE_RATIO = 0.01;

function roundedKg(value: number): number {
  return Math.round(value * 100) / 100;
}

function deriveWeighbridgeWetMass(
  arrivalMassKg: unknown,
  departureMassKg: unknown,
): number | null {
  return typeof arrivalMassKg === "number" &&
    typeof departureMassKg === "number" &&
    departureMassKg >= 0 &&
    arrivalMassKg >= departureMassKg
    ? roundedKg(arrivalMassKg - departureMassKg)
    : null;
}

interface TruckWeighingSectionProps {
  arrivalMassKg: unknown;
  departureMassKg: unknown;
  wetMassKg: unknown;
  wetMassLabel: string;
  onSuggestWetMass: (wetMassKg: number) => void;
  arrivalRegister: UseFormRegisterReturn;
  departureRegister: UseFormRegisterReturn;
  arrivalError?: string;
  departureError?: string;
  isSubmitting?: boolean;
}

export function TruckWeighingSection({
  arrivalMassKg,
  departureMassKg,
  wetMassKg,
  wetMassLabel,
  onSuggestWetMass,
  arrivalRegister,
  departureRegister,
  arrivalError,
  departureError,
  isSubmitting = false,
}: TruckWeighingSectionProps) {
  const weighbridgeWetMassKg = deriveWeighbridgeWetMass(
    arrivalMassKg,
    departureMassKg,
  );
  const lastWeighbridgeFillRef = useRef<number | null>(null);

  useEffect(() => {
    if (weighbridgeWetMassKg === null) {
      lastWeighbridgeFillRef.current = null;
      return;
    }
    const current = typeof wetMassKg === "number" ? wetMassKg : null;
    if (
      weighbridgeWetMassKg === lastWeighbridgeFillRef.current &&
      current === lastWeighbridgeFillRef.current
    ) {
      return;
    }
    if (current == null || current === lastWeighbridgeFillRef.current) {
      onSuggestWetMass(weighbridgeWetMassKg);
      lastWeighbridgeFillRef.current = weighbridgeWetMassKg;
    }
  }, [weighbridgeWetMassKg, wetMassKg, onSuggestWetMass]);

  const weighbridgeMismatch =
    weighbridgeWetMassKg !== null &&
    typeof wetMassKg === "number" &&
    Math.abs(wetMassKg - weighbridgeWetMassKg) >
      weighbridgeWetMassKg * WEIGHBRIDGE_MISMATCH_TOLERANCE_RATIO
      ? { enteredKg: wetMassKg, weighbridgeKg: weighbridgeWetMassKg }
      : null;

  return (
    <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
      <SectionLabel>Truck Weighing</SectionLabel>
      <p className="body-small text-[var(--color-text-tertiary)]">
        Weighbridge evidence for the wet mass: arrival - departure suggests the
        unloaded mass.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
        <FormField
          id="truckMassOnArrivalKg"
          label="Truck Mass Before Unloading (kg)"
          error={arrivalError}
        >
          <FormInput
            id="truckMassOnArrivalKg"
            type="number"
            step="any"
            placeholder="e.g., 15000"
            disabled={isSubmitting}
            error={!!arrivalError}
            {...arrivalRegister}
          />
        </FormField>

        <FormField
          id="truckMassOnDepartureKg"
          label="Truck Mass After Unloading (kg)"
          error={departureError}
        >
          <FormInput
            id="truckMassOnDepartureKg"
            type="number"
            step="any"
            placeholder="e.g., 5000"
            disabled={isSubmitting}
            error={!!departureError}
            {...departureRegister}
          />
        </FormField>
      </div>

      {weighbridgeMismatch && (
        <div
          role="alert"
          className="flex items-start gap-12 border border-[var(--color-signal-amber)] bg-[var(--color-signal-amber)]/5 p-16"
        >
          <Warning
            size={20}
            weight="fill"
            className="text-[var(--color-signal-amber)] mt-1 shrink-0"
          />
          <p className="body-small text-[var(--color-text-secondary)]">
            {wetMassLabel} ({weighbridgeMismatch.enteredKg.toFixed(2)} kg)
            deviates from the weighbridge difference (
            {weighbridgeMismatch.weighbridgeKg.toFixed(2)} kg = arrival -
            departure). Double-check the weighing or the entered mass.
          </p>
        </div>
      )}
    </div>
  );
}
