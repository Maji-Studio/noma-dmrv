/**
 * FacilityCertifierDialog
 * Modal form for linking / editing a facility's mapping to an Isometric project.
 */
"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Modal } from "@/components/ui";
import {
  FormActions,
  FormField,
  FormInput,
  FormSelect,
  ServerError,
} from "@/components/forms";
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
import { ProductionConfirmation } from "./production-confirmation";

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
    externalFacilityId: mapping?.externalFacilityId ?? "",
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      onOpen={() => reset(defaultValues)}
      ariaLabelledBy="facility-certifier-dialog-title"
      width="md"
    >
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-24"
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

        <FormField
          id="externalFacilityId"
          label="Isometric facility ID"
          error={errors.externalFacilityId?.message}
          helperText="Required for the telemetry pipeline only. Create the facility in the Certify UI (Isometric exposes no POST /facilities), then paste the fcl_… id here."
        >
          <FormInput
            id="externalFacilityId"
            error={!!errors.externalFacilityId}
            placeholder="fcl_1K9YJQNA7SBXAG15"
            {...register("externalFacilityId")}
          />
        </FormField>

        {isProduction && (
          <ProductionConfirmation
            actionLabel={
              mapping
                ? "update this facility's production Isometric link"
                : "link this facility to the production Isometric registry"
            }
            consequenceLabel="Future submissions from this facility will use production."
            registerProps={register("confirmProduction")}
            errorMessage={errors.confirmProduction?.message}
          />
        )}

        <FormActions
          onCancel={onClose}
          isSubmitting={isSubmitting || saveMutation.isPending}
          submitLabel={mapping ? "Save changes" : "Link project"}
        />
      </form>
    </Modal>
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
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="unlink-dialog-title"
      width="sm"
    >
      <div className="flex flex-col gap-24">
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
    </Modal>
  );
}
