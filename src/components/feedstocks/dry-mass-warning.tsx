/**
 * DryMassWarning component
 * Amber warning banner shown when allocated dry mass exceeds delivered dry mass.
 * Includes optional justification text field.
 */
"use client";

import { Warning } from "@phosphor-icons/react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { FormField, FormTextarea } from "@/components/forms";

interface DryMassWarningProps {
  allocatedKg: number;
  deliveredKg: number;
  /** register return for overrideJustification field */
  justificationRegister: UseFormRegisterReturn;
  justificationError?: string;
  disabled?: boolean;
}

export function DryMassWarning({
  allocatedKg,
  deliveredKg,
  justificationRegister,
  justificationError,
  disabled,
}: DryMassWarningProps) {
  const overageKg = allocatedKg - deliveredKg;
  const overagePercent = deliveredKg > 0 ? ((overageKg / deliveredKg) * 100).toFixed(1) : "N/A";

  return (
    <div className="border border-[var(--color-signal-amber)] bg-[var(--color-signal-amber)]/5 p-16 space-y-12">
      <div className="flex items-start gap-12">
        <Warning size={20} weight="fill" className="text-[var(--color-signal-amber)] mt-1 shrink-0" />
        <div className="space-y-4">
          <p className="body-medium font-medium text-[var(--color-text-primary)]">
            Allocated wet mass exceeds total delivery
          </p>
          <p className="body-small text-[var(--color-text-secondary)]">
            Allocated: {allocatedKg.toFixed(2)} kg &middot; Delivered: {deliveredKg.toFixed(2)} kg &middot; Over by {overageKg.toFixed(2)} kg ({overagePercent}%)
          </p>
        </div>
      </div>

      <FormField
        id="overrideJustification"
        label="Justification"
        error={justificationError}
        helperText="Explain why allocated mass exceeds the total delivery weight"
      >
        <FormTextarea
          id="overrideJustification"
          placeholder="e.g., Moisture reading may be inaccurate, prior bin stock included..."
          disabled={disabled}
          error={!!justificationError}
          rows={2}
          {...justificationRegister}
        />
      </FormField>
    </div>
  );
}
