"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react/dist/ssr";
import { METHOD_B_MINIMUM_METHOD_A_SAMPLES } from "@/config/certification";
import { FormField, FormInput, ServerError } from "@/components/forms";
import { FormSelect } from "@/components/forms/form-select";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useRecordMethodBPrerequisites } from "@/hooks/use-production-processes";
import {
  MOISTURE_PATHWAYS,
  recordMethodBPrerequisitesSchema,
  type RecordMethodBPrerequisitesInput,
} from "@/schemas/production-process";

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
  const {
    register,
    handleSubmit,
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

  const submit = handleSubmit(async (data) => {
    setServerError(null);
    try {
      await recordPrerequisites.mutateAsync(data);
      toast.success("Method-B prerequisites recorded");
      setOpen(false);
    } catch (error) {
      setServerError(
        error instanceof Error
          ? error.message
          : "The Method-B prerequisites were not recorded. Try again.",
      );
    }
  });

  return (
    <div className="border border-[var(--color-border-tertiary)] bg-[var(--color-background-medium)] p-12">
      <Button variant="noOutline" size="small" onClick={() => setOpen(!open)}>
        {open ? <CaretUpIcon size={16} /> : <CaretDownIcon size={16} />}
        {open ? "Hide Method-B prerequisites" : "Set up Method-B prerequisites"}
      </Button>

      {open && (
        <div className="mt-12 flex flex-col gap-16 border-t border-[var(--color-border-tertiary)] pt-12">
          <div className="grid grid-cols-1 gap-x-16 gap-y-20 sm:grid-cols-2">
            <FormField
              id="method-b-agreed-baseline"
              label="Agreed baseline size"
              error={errors.agreedBaselineSize?.message}
              required
            >
              <FormInput
                id="method-b-agreed-baseline"
                type="number"
                min={METHOD_B_MINIMUM_METHOD_A_SAMPLES}
                error={!!errors.agreedBaselineSize}
                disabled={recordPrerequisites.isPending}
                {...register("agreedBaselineSize")}
              />
            </FormField>
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
          {serverError && <ServerError message={serverError} />}
          <Button variant="primary" onClick={submit} busy={recordPrerequisites.isPending}>
            Record prerequisites
          </Button>
        </div>
      )}
    </div>
  );
}
