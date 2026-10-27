"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { FormActions, FormField, FormSelect, ServerError } from "@/components/forms";
import { useSaveRefusal } from "@/components/forms/use-save-refusal";
import { useToast } from "@/components/ui/toast";
import {
  useRegistrySourceVisibility,
  useSaveRegistrySourceVisibility,
} from "@/hooks/use-certification";
import {
  registrySourceVisibilitySchema,
  type RegistrySourceVisibilityInput,
} from "@/schemas/certification";

const VISIBILITY_OPTIONS = [
  { value: "private", label: "Private: verifier only" },
  { value: "public", label: "Public on the registry" },
] as const;

export function RegistrySourceVisibilitySettings() {
  const query = useRegistrySourceVisibility();

  if (query.isLoading) {
    return (
      <p className="body-medium text-[var(--color-text-tertiary)]">
        Loading organization policy…
      </p>
    );
  }
  if (query.error || !query.data) {
    return (
      <ServerError message="Couldn’t load the registry Source visibility policy. Refresh the page to retry." />
    );
  }

  const { sourceVisibility, viewerCanManage } = query.data;
  if (!viewerCanManage) {
    return (
      <div className="content-measure-form flex flex-col gap-8">
        <span className="body-medium">
          {sourceVisibility === "public"
            ? "Public on the registry"
            : "Private: verifier only"}
        </span>
        <p className="body-caption text-[var(--color-text-tertiary)]">
          Organization Admins manage this policy.
        </p>
        <PolicyTimingCopy />
      </div>
    );
  }

  return (
    <RegistrySourceVisibilityForm
      key={sourceVisibility}
      sourceVisibility={sourceVisibility}
    />
  );
}

function RegistrySourceVisibilityForm({
  sourceVisibility,
}: {
  sourceVisibility: RegistrySourceVisibilityInput["sourceVisibility"];
}) {
  const toast = useToast();
  const saveMutation = useSaveRegistrySourceVisibility();
  const formId = useId();
  const [serverError, setServerError] = useState("");
  const {
    register,
    handleSubmit,
    control,
    reset,
    resetField,
    setError,
    formState: { errors },
  } = useForm<RegistrySourceVisibilityInput>({
    resolver: zodResolver(registrySourceVisibilitySchema),
    defaultValues: { sourceVisibility },
  });

  const refuseSave = useSaveRefusal({ control, setError, resetField, formId });

  const onSubmit = async (input: RegistrySourceVisibilityInput) => {
    setServerError("");
    try {
      await saveMutation.mutateAsync(input);
      reset(input);
      toast.success("Registry Source visibility policy saved.");
    } catch (error) {
      setServerError(refuseSave(
        error,
        error instanceof Error
          ? error.message
          : "Registry Source visibility was not saved. Try again.",
      ) ?? "");
    }
  };

  return (
    <form
      id={formId}
      onSubmit={handleSubmit(onSubmit)}
      className="content-measure-form flex flex-col gap-20"
    >
      <FormField
        id="registry-source-visibility"
        label="Default visibility"
        error={errors.sourceVisibility?.message}
        cue="Applies to new Sources across the organization."
      >
        <FormSelect
          id="registry-source-visibility"
          options={VISIBILITY_OPTIONS}
          error={!!errors.sourceVisibility}
          defaultValue={sourceVisibility}
          {...register("sourceVisibility")}
        />
      </FormField>

      <PolicyTimingCopy />

      {/* control reports the draft to the settings console's unsaved guard. */}
      <FormActions
        control={control}
        isSubmitting={saveMutation.isPending}
        errorMessage={serverError}
        submitLabel="Save policy"
        sticky={false}
      />
    </form>
  );
}

function PolicyTimingCopy() {
  return (
    <p className="body-caption text-[var(--color-text-tertiary)]">
      Only new Sources use this setting. Existing Sources are unchanged.
    </p>
  );
}
