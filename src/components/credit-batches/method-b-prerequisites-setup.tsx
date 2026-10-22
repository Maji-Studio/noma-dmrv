"use client";

import { useId, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { GearIcon } from "@phosphor-icons/react/dist/ssr";
import { QuickAddDialogShell } from "@/components/forms/entity-select/quick-add-dialog-shell";
import { METHOD_B_MINIMUM_METHOD_A_SAMPLES } from "@/config/certification";
import { FormActions, FormField, FormInput } from "@/components/forms";
import { FormSelect } from "@/components/forms/form-select";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useRecordMethodBPrerequisites } from "@/hooks/use-production-processes";
import {
  MOISTURE_PATHWAYS,
  recordMethodBPrerequisitesSchema,
  type RecordMethodBPrerequisitesInput,
} from "@/schemas/production-process";
import { useSaveRefusal } from "@/components/forms/use-save-refusal";
import { toSaveErrorMessage } from "@/lib/stale-version";
import { numberInputConstraintsFor } from "@/lib/number-input-constraints";

/** Native min, max and step for each number input, read from the schema. */
const numberBounds = numberInputConstraintsFor(recordMethodBPrerequisitesSchema);

const MOISTURE_OPTIONS = MOISTURE_PATHWAYS.map((value) => ({
  value,
  label:
    value === "dry_weight_every_batch"
      ? "Dry weight for every batch"
      : value === "consistent_target_moisture"
        ? "Consistent target moisture"
        : "Moisture measured for every batch",
}));

interface MethodBPrerequisitesSetupProps {
  processId: string;
  agreedBaselineSize: number;
}

export function MethodBPrerequisitesSetup({
  processId,
  agreedBaselineSize,
}: MethodBPrerequisitesSetupProps) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const recordPrerequisites = useRecordMethodBPrerequisites();
  const toast = useToast();
  const formId = useId();
  const {
    register,
    handleSubmit,
    control,
    setError,
    resetField,
    formState: { errors },
  } = useForm<
    z.input<typeof recordMethodBPrerequisitesSchema>,
    unknown,
    RecordMethodBPrerequisitesInput
  >({
    resolver: zodResolver(recordMethodBPrerequisitesSchema),
    defaultValues: {
      processId,
      agreedBaselineSize: Math.max(
        agreedBaselineSize,
        METHOD_B_MINIMUM_METHOD_A_SAMPLES,
      ),
      randomSamplingPlanRef: "",
      moisturePathway: "measured_every_batch",
    },
  });

  const refuseSave = useSaveRefusal({ control, setError, resetField, formId });
  const submit = handleSubmit(async (data) => {
    setServerError(null);
    try {
      await recordPrerequisites.mutateAsync(data);
      toast.success("Method-B prerequisites recorded");
      setOpen(false);
    } catch (error) {
      setServerError(
        refuseSave(
          error,
          toSaveErrorMessage(error, "The Method-B prerequisites were not recorded. Try again."),
        ),
      );
    }
  });

  return (
    <>
      <div>
        <Button variant="noOutline" size="small" onClick={() => setOpen(true)}>
          <GearIcon size={16} weight="bold" />
          Set up Method-B prerequisites
        </Button>
      </div>

      <QuickAddDialogShell
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Method-B prerequisites"
        testId="method-b-prerequisites-dialog"
        dismissible={!recordPrerequisites.isPending}
      >
        <form id={formId} onSubmit={submit} className="flex flex-col gap-24">
          <div className="grid grid-cols-1 gap-x-16 gap-y-20">
            <FormField
              id="method-b-moisture-pathway"
              label="Moisture pathway"
              error={errors.moisturePathway?.message}
              required
            >
              <FormSelect
                id="method-b-moisture-pathway"
                options={MOISTURE_OPTIONS}
                error={!!errors.moisturePathway}
                disabled={recordPrerequisites.isPending}
                {...register("moisturePathway")}
              />
            </FormField>
            <FormField
              id="method-b-agreed-baseline"
              label="Agreed baseline size"
              error={errors.agreedBaselineSize?.message}
              required
            >
              <FormInput
                id="method-b-agreed-baseline"
                type="number"
                {...numberBounds("agreedBaselineSize")}
                error={!!errors.agreedBaselineSize}
                disabled={recordPrerequisites.isPending}
                {...register("agreedBaselineSize")}
              />
            </FormField>
          </div>
          <FormField
            id="method-b-random-plan"
            label="Random sampling plan reference"
            error={errors.randomSamplingPlanRef?.message}
            required
            helperText="Reference the agreed PDD or sampling-plan section."
          >
            <FormInput
              id="method-b-random-plan"
              placeholder="e.g., PDD §8.3 sampling plan"
              error={!!errors.randomSamplingPlanRef}
              disabled={recordPrerequisites.isPending}
              {...register("randomSamplingPlanRef")}
            />
          </FormField>
          <FormActions
            control={control}
            sticky={false}
            submitLabel="Record prerequisites"
            onCancel={() => setOpen(false)}
            isSubmitting={recordPrerequisites.isPending}
            errorMessage={serverError ?? undefined}
          />
        </form>
      </QuickAddDialogShell>
    </>
  );
}
