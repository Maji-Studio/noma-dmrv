"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { FormField, FormSelect, ServerError } from "@/components/forms";
import { Button } from "@/components/ui";
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
          Organization Owners and Admins manage this policy.
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
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegistrySourceVisibilityInput>({
    resolver: zodResolver(registrySourceVisibilitySchema),
    defaultValues: { sourceVisibility },
  });

  const onSubmit = async (input: RegistrySourceVisibilityInput) => {
    try {
      await saveMutation.mutateAsync(input);
      toast.success("Registry Source visibility policy saved.");
    } catch (error) {
      setError("root.serverError", {
        type: "server",
        message:
          error instanceof Error
            ? error.message
            : "The registry Source visibility was not saved. Try again.",
      });
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="content-measure-form flex flex-col gap-20"
    >
      <FormField
        id="registry-source-visibility"
        label="Default visibility"
        error={errors.sourceVisibility?.message}
        helperText="Applies to new Sources across the organization."
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

      {errors.root?.serverError?.message && (
        <ServerError message={errors.root.serverError.message} />
      )}

      <div>
        <Button type="submit" variant="primary" busy={saveMutation.isPending}>
          Save policy
        </Button>
      </div>
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
