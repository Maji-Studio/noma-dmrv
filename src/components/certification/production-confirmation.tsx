/**
 * ProductionConfirmation
 * Reusable inline production-environment gate for dialogs that perform an
 * irreversible (verifier-visible) write. Renders an inline EnvBanner plus a
 * descriptive checkbox bound to a react-hook-form `confirmProduction` field.
 */
"use client";

import type { UseFormRegisterReturn } from "react-hook-form";
import { FormError } from "@/components/forms";
import { EnvBanner } from "./env-banner";

interface ProductionConfirmationProps {
  /** What is about to happen, in lowercase verb form (e.g. "submit this removal"). */
  actionLabel: string;
  /** react-hook-form register output for the boolean confirmation field. */
  registerProps: UseFormRegisterReturn;
  errorMessage?: string;
}

export function ProductionConfirmation({
  actionLabel,
  registerProps,
  errorMessage,
}: ProductionConfirmationProps) {
  return (
    <div className="flex flex-col gap-12">
      <EnvBanner isProduction variant="inline" />
      <label className="flex items-start gap-12 body-small text-[var(--color-text-primary)] cursor-pointer">
        <input
          type="checkbox"
          className="mt-3 shrink-0"
          {...registerProps}
        />
        <span>
          I understand that this will {actionLabel} on the{" "}
          <strong className="font-semibold">production Isometric registry</strong>{" "}
          and create a verifier-visible record.
        </span>
      </label>
      <FormError message={errorMessage} />
    </div>
  );
}
