/**
 * ProductionConfirmation
 * Reusable inline production-environment gate for dialogs. Renders an inline
 * EnvBanner plus a descriptive checkbox bound to a react-hook-form
 * `confirmProduction` field.
 */
"use client";

import type { UseFormRegisterReturn } from "react-hook-form";
import { FormError } from "@/components/forms";
import { EnvBanner } from "./env-banner";

interface ProductionConfirmationProps {
  /** What is about to happen, written as a full sentence fragment. */
  actionLabel: string;
  /** Consequence shown after the action. Defaults to submission-specific copy. */
  consequenceLabel?: string;
  /** react-hook-form register output for the boolean confirmation field. */
  registerProps: UseFormRegisterReturn;
  errorMessage?: string;
}

export function ProductionConfirmation({
  actionLabel,
  consequenceLabel = "This creates a verifier-visible record.",
  registerProps,
  errorMessage,
}: ProductionConfirmationProps) {
  return (
    <div className="flex flex-col gap-12">
      <EnvBanner isProduction variant="inline" />
      <label className="flex items-start gap-12 body-small text-[var(--color-text-primary)] cursor-pointer">
        <input
          type="checkbox"
          className="mt-2 shrink-0"
          {...registerProps}
        />
        <span>
          I understand that this will {actionLabel}.{" "}
          <strong className="body-small-bold">{consequenceLabel}</strong>
        </span>
      </label>
      <FormError message={errorMessage} />
    </div>
  );
}
