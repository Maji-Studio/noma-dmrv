/**
 * Switch template — pins a credit batch to another Removal template of the
 * facility's Isometric project. The list is the same live project template list
 * the facility default picker uses, narrowed to Removal templates.
 *
 * The server refuses a switch on a batch a submitted Removal holds, and a stale
 * version; both come back as the form error and the dialog stays open.
 *
 * Once another template is chosen, the dialog previews its line review: how
 * many lines need review (they block the batch's Removals until an Owner or
 * Admin reviews them) or that all are reviewed. The preview informs the choice
 * and never blocks the switch.
 *
 * The form sends the batch version it opened on, never a refetched one, so a
 * concurrent switch is refused instead of overwritten (#768). After a stale
 * refusal the choice stays; "Discard changes and reload" is the one way to move
 * to the latest batch values.
 */
"use client";

import { useContext, useState } from "react";
import { useController, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { EntitySelect, FormActions, FormField } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { FormDialogContext } from "@/components/ui/form-dialog-context";
import { useToast } from "@/components/ui/toast";
import { useSwitchCreditBatchRemovalTemplate } from "@/hooks/use-removal-template-review";
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import { TemplateReviewPreview } from "./credit-batch-template-review-preview";
import { getStaleVersionConflict, toSaveErrorMessage } from "@/lib/stale-version";
import {
  switchRemovalTemplateFormSchema,
  type SwitchRemovalTemplateFormValues,
} from "@/schemas/removal-template-review";

const DIALOG_TITLE_ID = "credit-batch-template-switch-title";

export interface CreditBatchTemplateSwitchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** A stale refusal: refetch the batch so a reload can show its latest values. */
  onStale?: () => void;
  creditBatch: { id: string; code: string; facilityId: string; version: number; removalTemplateId: string | null };
  /** The facility default, marked in the list. */
  defaultTemplateId: string | null;
  templates: IsometricGhgEntryTemplate[] | undefined;
  templatesLoading: boolean;
  templatesError: Error | null;
  /** Why no template can be listed (no project link), shown under the select. */
  unavailableReason?: string;
}

export function CreditBatchTemplateSwitchDialog(props: CreditBatchTemplateSwitchDialogProps) {
  return (
    <FormDialog isOpen={props.isOpen} onClose={props.onClose} ariaLabelledBy={DIALOG_TITLE_ID} width="md">
      <SwitchTemplateForm key={props.isOpen ? "open" : "closed"} {...props} />
    </FormDialog>
  );
}

function SwitchTemplateForm({
  onClose,
  onStale,
  creditBatch,
  defaultTemplateId,
  templates,
  templatesLoading,
  templatesError,
  unavailableReason,
}: CreditBatchTemplateSwitchDialogProps) {
  const {
    control,
    handleSubmit,
    setError,
    clearErrors,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SwitchRemovalTemplateFormValues>({
    resolver: zodResolver(switchRemovalTemplateFormSchema),
    defaultValues: { removalTemplateId: creditBatch.removalTemplateId ?? "" },
  });
  // The batch as the dialog opened on it: the save precondition for this draft.
  const [baseline, setBaseline] = useState(() => ({
    version: creditBatch.version,
    removalTemplateId: creditBatch.removalTemplateId ?? "",
  }));
  const [stale, setStale] = useState(false);
  const { field } = useController({ control, name: "removalTemplateId" });
  const dialogActions = useContext(FormDialogContext);
  const switchTemplate = useSwitchCreditBatchRemovalTemplate();
  const toast = useToast();

  // Only Removal templates can be pinned; the action refuses anything else.
  const options = (templates ?? [])
    .filter((template) => template.credit_type === "REMOVAL")
    .map((template) => ({
      id: template.id,
      code: template.id,
      name: template.display_name,
      subtitle: template.id === creditBatch.removalTemplateId
        ? "Current template"
        : template.id === defaultTemplateId ? "Facility default" : undefined,
    }));
  const unchanged = field.value === baseline.removalTemplateId;

  const reloadLatest = () => {
    const latest = { version: creditBatch.version, removalTemplateId: creditBatch.removalTemplateId ?? "" };
    setBaseline(latest);
    setStale(false);
    reset({ removalTemplateId: latest.removalTemplateId });
    clearErrors();
  };

  const onSubmit = async (values: SwitchRemovalTemplateFormValues) => {
    try {
      await switchTemplate.mutateAsync({
        creditBatchId: creditBatch.id,
        removalTemplateId: values.removalTemplateId,
        expectedVersion: baseline.version,
      });
      reset(values);
      dialogActions?.markSaved(control);
      toast.success(`Removal template switched for ${creditBatch.code}.`);
      onClose();
    } catch (error) {
      if (getStaleVersionConflict(error)) {
        setStale(true);
        onStale?.();
      }
      setError("root.serverError", {
        type: "server",
        message: toSaveErrorMessage(error, "The Removal template was not switched. Try again."),
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-24">
      <header className="flex flex-col gap-4">
        <h2 id={DIALOG_TITLE_ID} className="title-heading-3">Switch template</h2>
        <p className="body-small text-[var(--color-text-secondary)]">
          {`Removals for ${creditBatch.code} use this template's lines.`}
        </p>
      </header>

      <FormField
        id="removalTemplateId"
        label="Removal template"
        required
        error={errors.removalTemplateId?.message}
        cue={unavailableReason ?? (!templatesLoading && options.length === 0 && !templatesError ? "This project has no Removal templates." : undefined)}
      >
        <EntitySelect
          id="removalTemplateId"
          optionLabel="Removal template"
          placeholder="Select a template"
          options={options}
          isLoading={templatesLoading}
          disabled={!!unavailableReason}
          loadError={options.length === 0 ? templatesError : null}
          error={!!errors.removalTemplateId}
          value={field.value}
          onChange={(value) => field.onChange(value ?? "")}
          onBlur={field.onBlur}
        />
      </FormField>

      {!unchanged && !unavailableReason && (
        <TemplateReviewPreview
          facilityId={creditBatch.facilityId}
          removalTemplateId={field.value}
          creditBatchCode={creditBatch.code}
        />
      )}

      <FormActions
        control={control}
        onCancel={onClose}
        isSubmitting={isSubmitting || switchTemplate.isPending}
        errorMessage={errors.root?.serverError?.message}
        errorAction={stale ? (
          <Button size="small" variant="weak" onClick={reloadLatest}>
            Discard changes and reload
          </Button>
        ) : undefined}
        submitDisabled={unchanged || stale}
        submitVariant="default"
        submitLabel="Switch template"
        submittingLabel="Switching…"
      />
    </form>
  );
}
