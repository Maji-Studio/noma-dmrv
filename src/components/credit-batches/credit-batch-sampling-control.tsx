"use client";

import type { ReactNode } from "react";
import { InfoHint } from "@/components/ui/tooltip";
import type { MethodBEligibility } from "@/lib/certification/method-b-eligibility";
import type { CreditBatchSampling } from "@/schemas/credit-batches";

interface CreditBatchSamplingControlProps {
  visible: boolean;
  isEditMode: boolean;
  value: CreditBatchSampling;
  onChange: (value: CreditBatchSampling) => void;
  eligibility?: MethodBEligibility;
  isLoading?: boolean;
  canManage: boolean;
  prerequisitesSetup?: ReactNode;
  disabled?: boolean;
}

export function CreditBatchSamplingControl({
  visible,
  isEditMode,
  value,
  onChange,
  eligibility,
  isLoading = false,
  canManage,
  prerequisitesSetup,
  disabled = false,
}: CreditBatchSamplingControlProps) {
  if (!visible) return null;

  if (isEditMode) {
    return (
      <div
        className="flex flex-col gap-4 border-l-2 border-[var(--color-border-primary)] bg-[var(--color-background-sunken)] px-16 py-12"
        data-testid="sampling-read-only"
      >
        <span className="body-small font-medium text-[var(--color-text-primary)]">
          Sampling: {value === "unsampled" ? "Unsampled" : "Sampled"}
        </span>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          Fixed when the credit batch was created and cannot be changed.
        </span>
      </div>
    );
  }

  const countMet =
    !!eligibility &&
    eligibility.eligibleSampleCount >= eligibility.agreedBaselineSize;
  const unsampledDisabled = disabled || isLoading || !eligibility?.unsampledAllowed;
  const hint = isLoading
    ? "Checking Method-B eligibility…"
    : !eligibility
      ? "Select a feedstock type to check Method-B eligibility."
      : eligibility.unsampledAllowed
        ? "The agreed baseline and Method-B prerequisites are complete."
        : !countMet
          ? `${eligibility.eligibleSampleCount} / ${eligibility.agreedBaselineSize} eligible samples recorded. Unsampled batches become available when the agreed baseline is met.`
          : canManage
            ? "The sample baseline is met. Record the Method-B prerequisites to enable unsampled batches."
            : "The sample baseline is met, but Method B requires admin setup."

  return (
    <fieldset className="flex flex-col gap-10" data-testid="sampling-control">
      <legend className="inline-flex items-center gap-6 body-small font-medium text-[var(--color-text-primary)]">
        Sampling
        <InfoHint label="About sampling eligibility">{hint}</InfoHint>
      </legend>
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
        <label className="flex min-h-44 cursor-pointer items-center gap-10 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-12 py-8 body-small">
          <input
            type="radio"
            name="sampling-choice"
            value="sampled"
            checked={value === "sampled"}
            onChange={() => onChange("sampled")}
            disabled={disabled}
          />
          <span className="flex flex-col gap-2">
            <span className="font-medium">Sampled</span>
            <span className="body-caption text-[var(--color-text-tertiary)]">
              Method A · sampled batch
            </span>
          </span>
        </label>
        <label
          className="flex min-h-44 items-center gap-10 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-12 py-8 body-small has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-40"
        >
          <input
            type="radio"
            name="sampling-choice"
            value="unsampled"
            checked={value === "unsampled"}
            onChange={() => onChange("unsampled")}
            disabled={unsampledDisabled}
          />
          <span className="flex flex-col gap-2">
            <span className="font-medium">Unsampled</span>
            <span className="body-caption text-[var(--color-text-tertiary)]">
              Method B · computed eligibility
            </span>
          </span>
        </label>
      </div>
      {countMet && !eligibility?.prerequisitesRecorded && canManage && prerequisitesSetup}
    </fieldset>
  );
}
