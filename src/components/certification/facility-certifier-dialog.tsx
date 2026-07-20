/**
 * FacilityCertifierDialog
 * Modal form for linking / editing a facility's mapping to an Isometric project.
 */
"use client";

import { useEffect, useState } from "react";
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
import {
  saveMappingSchema,
  type SaveMappingInput,
} from "@/schemas/certification";
import {
  useIsometricProjectTemplates,
  useSaveFacilityCertifierMapping,
} from "@/hooks/use-certification";
import type { FacilityCertifierMapping } from "@/fn/certification/facility-mapping";
import { DEFAULT_PROTOCOL_SLUG } from "@/config/certification";
import { ProductionConfirmation } from "./production-confirmation";
import { ConfirmActionDialog } from "./confirm-action-dialog";

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
    protocolSlug: mapping?.protocolSlug ?? DEFAULT_PROTOCOL_SLUG,
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

  // Acknowledgment that this project is intentionally being shared with another
  // facility. Sharing a project stays allowed (operators register multiple
  // sites under one registry project), but it now requires an explicit opt-in
  // rather than passing silently. Not persisted — a per-open UI gate.
  const [acknowledgeSharedProject, setAcknowledgeSharedProject] =
    useState(false);

  const watchedProjectId = watch("externalProjectId");
  const { data: liveTemplates, isLoading: templatesLoading } =
    useIsometricProjectTemplates(watchedProjectId || null);

  // When the project changes, clear project-scoped registry identifiers and
  // reset the share acknowledgment. A stale template or facility id from the
  // previous Isometric project would fail validation or send telemetry to the
  // wrong facility, and the ack must be re-confirmed for the new project.
  useEffect(() => {
    if (!watchedProjectId || mapping?.externalProjectId !== watchedProjectId) {
      setValue("defaultRemovalTemplateId", "");
      setValue("externalFacilityId", "");
      setAcknowledgeSharedProject(false);
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
  // Only REMOVAL templates are valid bindings — the save action rejects
  // anything else, so don't offer REDUCTION templates in the first place.
  const templateOptions = templates
    .filter((t) => t.credit_type === "REMOVAL")
    .map((t) => ({
      value: t.id,
      label: `${t.display_name} — ${t.id}`,
    }));

  const linkedHintForSelected = watchedProjectId
    ? linkedFacilitiesByProject.get(watchedProjectId)
    : undefined;
  // Selected project is already linked to a different facility → sharing it
  // requires an explicit opt-in before save.
  const requiresShareAck = (linkedHintForSelected?.length ?? 0) > 0;
  const blockedOnShareAck = requiresShareAck && !acknowledgeSharedProject;

  const onSubmit = async (data: SaveMappingInput) => {
    if (requiresShareAck && !acknowledgeSharedProject) {
      setError("root.serverError", {
        type: "manual",
        message:
          "Confirm you intend to share this project with another facility.",
      });
      return;
    }
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
      onOpen={() => {
        reset(defaultValues);
        setAcknowledgeSharedProject(false);
      }}
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
        >
          <FormSelect
            id="externalProjectId"
            placeholder="Select a project"
            options={projectOptions}
            error={!!errors.externalProjectId}
            {...register("externalProjectId")}
          />
        </FormField>

        {requiresShareAck && (
          <div className="flex flex-col gap-12 border border-[var(--color-signal-amber)] bg-[var(--color-signal-amber-subtle)] p-16">
            <p className="body-small text-[var(--color-text-primary)]">
              This project is already linked to{" "}
              <strong className="body-small-bold">
                {linkedHintForSelected?.join(", ")}
              </strong>
              . Submissions from both facilities will target the same Isometric
              project. The Isometric facility ID below stays unique per facility.
            </p>
            <label className="flex items-start gap-12 body-small text-[var(--color-text-primary)] cursor-pointer">
              <input
                type="checkbox"
                className="mt-2 shrink-0"
                checked={acknowledgeSharedProject}
                onChange={(e) =>
                  setAcknowledgeSharedProject(e.target.checked)
                }
              />
              <span>
                I intend to share this project across facilities.
              </span>
            </label>
          </div>
        )}

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
          id="externalFacilityId"
          label="Isometric facility ID"
          error={errors.externalFacilityId?.message}
          hint="Required for the telemetry pipeline only. Create the facility in the Certify UI (Isometric exposes no POST /facilities), then paste the fcl_… id here."
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
          submitDisabled={blockedOnShareAck}
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
    <ConfirmActionDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      isPending={isPending}
      errorMessage={errorMessage}
      variant="neutral"
      title="Unlink Isometric project"
      confirmLabel="Unlink"
      busyLabel="Unlinking…"
      body="The facility will no longer be associated with the Isometric project. Past submissions stay on Isometric."
    />
  );
}
