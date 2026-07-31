/**
 * WetMassWarning component
 * Compact over-allocation feedback with the required justification field.
 */
"use client";

import type { UseFormRegisterReturn } from "react-hook-form";
import { FormField, FormTextarea } from "@/components/forms";
import { formatMassKg } from "@/lib/format-utils";

interface WetMassWarningProps {
  allocatedKg: number;
  deliveredKg: number;
  /** register return for overrideJustification field */
  justificationRegister: UseFormRegisterReturn;
  justificationError?: string;
  disabled?: boolean;
}

export function WetMassWarning({
  allocatedKg,
  deliveredKg,
  justificationRegister,
  justificationError,
  disabled,
}: WetMassWarningProps) {
  const overageKg = allocatedKg - deliveredKg;

  return (
    <div className="border-l-2 border-[var(--color-signal-orange)] bg-[var(--color-signal-orange-light)] px-12 py-8">
      <FormField
        id="overrideJustification"
        label="Over-allocation justification"
        error={justificationError}
        warning={`${formatMassKg(overageKg)} over delivery. Add a justification.`}
      >
        <FormTextarea
          id="overrideJustification"
          placeholder="Explain the difference..."
          disabled={disabled}
          error={!!justificationError}
          rows={2}
          {...justificationRegister}
        />
      </FormField>
    </div>
  );
}
