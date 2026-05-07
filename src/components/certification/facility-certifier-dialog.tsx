/**
 * FacilityCertifierDialog
 * Modal form for linking / editing a facility's mapping to an Isometric project.
 */
"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui";
import {
  FormActions,
  FormField,
  FormInput,
  FormSelect,
  ServerError,
} from "@/components/forms";
import { useDialog } from "@/hooks/use-dialog";
import { useToast } from "@/components/ui/toast";
import {
  saveMappingSchema,
  type SaveMappingInput,
} from "@/schemas/certification";
import {
  useIsometricProjectTemplates,
  useSaveFacilityCertifierMapping,
} from "@/hooks/use-certification";
import type { FacilityCertifierMapping } from "@/fn/certification/facility-mapping";

interface FacilityCertifierDialogProps {
  isOpen: boolean;
  onClose: () => void;
  facilityId: string;
  loaderData: FacilityCertifierMapping;
}

export function FacilityCertifierDialog({
  isOpen,
  onClose,
  facilityId,
  loaderData,
}: FacilityCertifierDialogProps) {
  const { mapping, availableProjects, linkHints, isProduction } = loaderData;

  const defaultValues: SaveMappingInput = {
    facilityId,
    externalProjectId: mapping?.externalProjectId ?? "",
    protocolSlug: mapping?.protocolSlug ?? "biochar",
    protocolVersion: mapping?.protocolVersion ?? "",
    defaultRemovalTemplateId: mapping?.defaultRemovalTemplateId ?? "",
    confirmProduction: false,
  };

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SaveMappingInput>({
    resolver: zodResolver(saveMappingSchema),
    defaultValues,
  });

  const dialogRef = useDialog(isOpen, onClose, () => reset(defaultValues));
  const toast = useToast();
  const saveMutation = useSaveFacilityCertifierMapping();

  const watchedProjectId = watch("externalProjectId");
  const { data: liveTemplates, isLoading: templatesLoading } =
    useIsometricProjectTemplates(watchedProjectId || null);

  // When the project changes, clear the template (a stale template ID would
  // belong to the previous project and fail server-side validation).
  useEffect(() => {
    if (
      watchedProjectId &&
      mapping?.externalProjectId !== watchedProjectId
    ) {
      setValue("defaultRemovalTemplateId", "");
    }
  }, [watchedProjectId, mapping?.externalProjectId, setValue]);

  const linkedFacilitiesByProject = (() => {
    const map = new Map<string, string[]>();
    for (const hint of linkHints) {
      const others = hint.linkedFacilities
        .filter((f) => f.facilityId !== facilityId)
        .map((f) => `${f.code} (${f.name})`);
      if (others.length > 0) map.set(hint.externalProjectId, others);
    }
    return map;
  })();

  const projectOptions = availableProjects.map((project) => ({
    value: project.id,
    label: `${project.name} — ${project.id}`,
  }));

  const templates = liveTemplates ?? loaderData.availableTemplates;
  const templateOptions = templates.map((t) => ({
    value: t.id,
    label: `${t.display_name} — ${t.id}`,
  }));

  const onSubmit = async (data: SaveMappingInput) => {
    try {
      await saveMutation.mutateAsync(data);
      toast.success("Certifier mapping saved");
      onClose();
    } catch (error) {
      setError("root.serverError", {
        type: "server",
        message:
          error instanceof Error ? error.message : "Failed to save mapping",
      });
    }
  };

  const linkedHintForSelected = watchedProjectId
    ? linkedFacilitiesByProject.get(watchedProjectId)
    : undefined;

  const templateHelperText = (() => {
    if (!watchedProjectId) return "Pick a project to load templates.";
    if (templatesLoading) return "Loading templates…";
    if (templateOptions.length === 0) return "This project has no removal templates.";
    return "Used as the default when submitting credit batches.";
  })();

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      className="p-0 border border-[var(--color-border-primary)] backdrop:bg-black/50 w-[560px] max-w-[90vw]"
      aria-labelledby="facility-certifier-dialog-title"
    >
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-24 p-32"
      >
        <header className="flex flex-col gap-4">
          <h2
            id="facility-certifier-dialog-title"
            className="title-heading-3"
          >
            {mapping ? "Edit certifier mapping" : "Link Isometric project"}
          </h2>
          <p className="body-small text-[var(--color-text-secondary)]">
            Tells noma which Isometric project receives credit batch
            submissions for this facility.
          </p>
        </header>

        {errors.root?.serverError?.message && (
          <ServerError message={errors.root.serverError.message} />
        )}

        <FormField
          id="externalProjectId"
          label="Isometric project"
          required
          error={errors.externalProjectId?.message}
          helperText={
            linkedHintForSelected
              ? `Already linked to: ${linkedHintForSelected.join(", ")}`
              : undefined
          }
        >
          <FormSelect
            id="externalProjectId"
            placeholder="Select a project"
            options={projectOptions}
            error={!!errors.externalProjectId}
            {...register("externalProjectId")}
          />
        </FormField>

        <FormField
          id="defaultRemovalTemplateId"
          label="Default removal template"
          error={errors.defaultRemovalTemplateId?.message}
          helperText={templateHelperText}
        >
          <FormSelect
            id="defaultRemovalTemplateId"
            placeholder="No default"
            options={templateOptions}
            error={!!errors.defaultRemovalTemplateId}
            disabled={!watchedProjectId || templatesLoading}
            {...register("defaultRemovalTemplateId")}
          />
        </FormField>

        <FormField
          id="protocolVersion"
          label="Protocol version"
          error={errors.protocolVersion?.message}
          helperText="Optional. Use the registry minor version, e.g. 1.2."
        >
          <FormInput
            id="protocolVersion"
            error={!!errors.protocolVersion}
            placeholder="1.2"
            {...register("protocolVersion")}
          />
        </FormField>

        {isProduction && (
          <label className="flex items-start gap-12 border border-[var(--color-signal-red)] p-16 bg-[var(--color-background-medium)]">
            <input
              type="checkbox"
              className="mt-4"
              {...register("confirmProduction")}
            />
            <span className="body-small text-[var(--color-text-primary)]">
              I understand this saves against the{" "}
              <strong>production</strong> Isometric environment, and any
              future submissions from this facility will be live.
            </span>
          </label>
        )}

        <FormActions
          onCancel={onClose}
          isSubmitting={isSubmitting || saveMutation.isPending}
          submitLabel={mapping ? "Save changes" : "Link project"}
        />
      </form>
    </dialog>
  );
}

interface UnlinkConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
  errorMessage?: string;
}

export function UnlinkConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  isPending,
  errorMessage,
}: UnlinkConfirmDialogProps) {
  const dialogRef = useDialog(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      className="p-32 border border-[var(--color-border-primary)] backdrop:bg-black/50"
      aria-labelledby="unlink-dialog-title"
    >
      <div className="flex flex-col gap-24 min-w-[360px]">
        <h2 id="unlink-dialog-title" className="title-heading-3">
          Unlink Isometric project
        </h2>
        <p className="body-medium text-[var(--color-text-secondary)]">
          The facility will no longer be associated with the Isometric
          project. Past submissions stay on Isometric.
        </p>
        {errorMessage && <ServerError message={errorMessage} />}
        <div className="flex gap-16 justify-end">
          <Button
            size="large"
            variant="default"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            size="large"
            variant="default"
            className="bg-[var(--color-signal-red)] text-white border-[var(--color-signal-red)] hover:opacity-90"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? "Unlinking…" : "Unlink"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
