"use client";

import type { ReactNode } from "react";
import { CalculatorIcon, TestTubeIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField } from "@/components/forms/form-field";
import { ChoiceCardGroup } from "@/components/forms/choice-card-group";
import type { MethodBEligibility } from "@/lib/certification/method-b-eligibility";
import type { CreditBatchSampling } from "@/schemas/credit-batches";
import { formatCount } from "@/lib/copy-utils";
import { Notice } from "@/components/ui/notice";

const SAMPLING_ART_SIZE = 20;

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
      <Notice
        tone="info"
        title={`Sampling: ${value === "unsampled" ? "Unsampled" : "Sampled"}`}
        data-testid="sampling-read-only"
      >
        Fixed when the credit batch was created and cannot be changed.
      </Notice>
    );
  }

  const countMet =
    !!eligibility &&
    eligibility.eligibleSampleCount >= eligibility.agreedBaselineSize;
  const unsampledDisabled = disabled || isLoading || !eligibility?.unsampledAllowed;
  const hint = isLoading
    ? "Checking Method B eligibility…"
    : !eligibility
      ? "Select a feedstock type to check Method B eligibility."
      : eligibility.unsampledAllowed
        ? "The Method-B baseline and prerequisites are complete."
        : !countMet
          ? `${formatCount(eligibility.eligibleSampleCount, "qualifying Method-A Sample")} recorded. Record at least ${eligibility.agreedBaselineSize} to meet the Method-B baseline.`
          : canManage
            ? "The Method-B baseline is met. Record the Method-B prerequisites to enable unsampled credit batches."
            : "The Method-B baseline is met. An Admin must record the Method-B prerequisites."

  return (
    <div data-testid="sampling-control" className="flex flex-col gap-8">
      <FormField id="sampling-choice" label="Sampling" helperText={hint}>
        <ChoiceCardGroup
          id="sampling-choice"
          legend="Sampling"
          name="sampling-choice"
          value={value}
          options={[
            {
              value: "sampled",
              title: "Sampled",
              description: "Method A, lab sampled",
              art: <TestTubeIcon size={SAMPLING_ART_SIZE} weight="bold" />,
              disabled,
            },
            {
              value: "unsampled",
              title: "Unsampled",
              description: "Method B, computed",
              art: <CalculatorIcon size={SAMPLING_ART_SIZE} weight="bold" />,
              disabled: unsampledDisabled,
            },
          ]}
          onValueChange={(next) => onChange(next as CreditBatchSampling)}
        />
      </FormField>
      {countMet && !eligibility?.prerequisitesRecorded && canManage && prerequisitesSetup}
    </div>
  );
}
