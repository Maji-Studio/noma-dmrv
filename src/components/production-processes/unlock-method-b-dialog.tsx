/**
 * UnlockMethodBDialog — the deliberate Method-B unlock for a production process
 * (ADR 0017 Track 2, item 2 / D3·D4·D7).
 *
 * Captures the three protocol prerequisites a sample count cannot infer
 * (`G-F74T-0` agreed baseline, `R-S8K1-1` random-sampling plan, `R-ADXG-0`
 * moisture pathway), then flips the process to Method B. The app-layer guard +
 * DB trigger both re-assert the ≥30-sample baseline; an under-baseline attempt
 * surfaces here via the server error.
 *
 * The protocol-cited explainer (`MethodBExplainer`) renders only when the
 * facility is on Isometric (D5) — the caller resolves that and passes `isIsometric`.
 */
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Modal } from "@/components/ui";
import {
  FormActions,
  FormField,
  FormInput,
  FormSelect,
  ServerError,
} from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import { METHOD_B_MINIMUM_METHOD_A_SAMPLES } from "@/config/certification";
import { useUnlockMethodB } from "@/hooks/use-production-processes";
import {
  DEFAULT_MOISTURE_PATHWAY,
  MOISTURE_PATHWAYS,
  MOISTURE_PATHWAY_DESCRIPTIONS,
  MOISTURE_PATHWAY_LABELS,
  unlockMethodBSchema,
  type UnlockMethodBInput,
} from "@/schemas/production-process";
import type { ProductionProcessSummary } from "@/data-access/production-processes";
import { MethodBExplainer } from "./method-b-explainer";

const TITLE_ID = "unlock-method-b-title";

const MOISTURE_OPTIONS = MOISTURE_PATHWAYS.map((pathway) => ({
  value: pathway,
  label: MOISTURE_PATHWAY_LABELS[pathway],
}));

interface UnlockMethodBDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The process being unlocked. Null while no row is selected. */
  process: ProductionProcessSummary | null;
  /** Show the protocol-cited explainer (facility is on Isometric). */
  isIsometric: boolean;
}

export function UnlockMethodBDialog({
  isOpen,
  onClose,
  process,
  isIsometric,
}: UnlockMethodBDialogProps) {
  const toast = useToast();
  const unlock = useUnlockMethodB();

  const defaultValues: UnlockMethodBInput = {
    processId: process?.id ?? "",
    agreedBaselineSize: METHOD_B_MINIMUM_METHOD_A_SAMPLES,
    randomSamplingPlanRef: "",
    moisturePathway: DEFAULT_MOISTURE_PATHWAY,
  };

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(unlockMethodBSchema),
    defaultValues,
  });

  const selectedPathway = watch("moisturePathway");

  const onSubmit = async (data: UnlockMethodBInput) => {
    try {
      await unlock.mutateAsync(data);
      toast.success("Method B unlocked for this production process");
      onClose();
    } catch (error) {
      setError("root.serverError", {
        type: "server",
        message:
          error instanceof Error ? error.message : "Failed to unlock Method B",
      });
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      onOpen={() => reset(defaultValues)}
      ariaLabelledBy={TITLE_ID}
      width="md"
      dismissOnClickOutside={false}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-24">
        <header className="flex flex-col gap-4">
          <h2 id={TITLE_ID} className="title-heading-3">
            Unlock Method B
          </h2>
          <p className="body-small text-[var(--color-text-secondary)]">
            {process
              ? `${process.feedstockName} (${process.feedstockCode}) — ${process.eligibleSampleCount} eligible samples collected.`
              : "Switch this production process to Method-B sampling."}
          </p>
        </header>

        {errors.root?.serverError?.message && (
          <ServerError message={errors.root.serverError.message} />
        )}

        {isIsometric && <MethodBExplainer title="What you're agreeing to" />}

        <FormField
          id="agreedBaselineSize"
          label="Agreed baseline size"
          required
          error={errors.agreedBaselineSize?.message}
          helperText={`The Method-A sample count agreed with Isometric (minimum ${METHOD_B_MINIMUM_METHOD_A_SAMPLES}).`}
        >
          <FormInput
            id="agreedBaselineSize"
            type="number"
            min={METHOD_B_MINIMUM_METHOD_A_SAMPLES}
            step={1}
            error={!!errors.agreedBaselineSize}
            {...register("agreedBaselineSize")}
          />
        </FormField>

        <FormField
          id="randomSamplingPlanRef"
          label="Random-sampling plan reference"
          required
          error={errors.randomSamplingPlanRef?.message}
          hint="A reference to the random-sampling plan agreed with Isometric and documented in the PDD (`R-S8K1-1`) — a document name, section, or version."
        >
          <FormInput
            id="randomSamplingPlanRef"
            placeholder="e.g. PDD §6.2 sampling plan v3"
            error={!!errors.randomSamplingPlanRef}
            {...register("randomSamplingPlanRef")}
          />
        </FormField>

        <FormField
          id="moisturePathway"
          label="Moisture-determination pathway"
          required
          error={errors.moisturePathway?.message}
          helperText={MOISTURE_PATHWAY_DESCRIPTIONS[selectedPathway]}
        >
          <FormSelect
            id="moisturePathway"
            options={MOISTURE_OPTIONS}
            error={!!errors.moisturePathway}
            {...register("moisturePathway")}
          />
        </FormField>

        <FormActions
          onCancel={onClose}
          isSubmitting={isSubmitting || unlock.isPending}
          submitLabel="Unlock Method B"
        />
      </form>
    </Modal>
  );
}
