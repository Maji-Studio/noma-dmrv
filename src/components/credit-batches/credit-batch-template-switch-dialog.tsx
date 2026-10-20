/**
 * Switch template — pins a credit batch to another Removal template of the
 * facility's Isometric project. The list is the same live project template list
 * the facility default picker uses, narrowed to Removal templates.
 *
 * The server refuses a switch on a batch a submitted Removal holds, and a stale
 * version; both come back as the form error and the dialog stays open.
 *
 * Only ready templates can be chosen: read in full, set up, and with no lines
 * to decide. A template that is not ready stays in the list, disabled, with its
 * count ("3 lines to decide"), and the dialog links each one to Removal
 * templates ("Decide lines"). The batch's current template stays selectable
 * even when it is not ready. The server refuses a template that is not ready.
 *
 * The form sends the batch version it opened on, never a refetched one, so a
 * concurrent switch is refused instead of overwritten (#768). After a stale
 * refusal the choice stays; "Discard changes and reload" is the one way to move
 * to the latest batch values.
 */
"use client";

import { useContext, useState } from "react";
import Link from "next/link";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";
import { useController, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { EntitySelect, FormActions, FormField } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { FormDialogContext } from "@/components/ui/form-dialog-context";
import { useToast } from "@/components/ui/toast";
import { useSwitchCreditBatchRemovalTemplate } from "@/hooks/use-removal-template-review";
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import { Notice } from "@/components/ui/notice";
import { certificationRemovalTemplatesHref, DECIDE_LINES_LINK_LABEL } from "@/lib/certification/links";
import { getStaleVersionConflict, toSaveErrorMessage } from "@/lib/stale-version";
import {
  switchRemovalTemplateFormSchema,
  type SwitchRemovalTemplateFormValues,
} from "@/schemas/removal-template-review";

const DIALOG_TITLE_ID = "credit-batch-template-switch-title";

// A batch with no pin sets its first template; a pinned one switches.
const SWITCH_COPY = {
  title: "Switch template",
  submitting: "Switching…",
  success: (code: string) => `Removal template switched for ${code}.`,
  failure: "The Removal template was not switched. Try again.",
};
const SET_COPY = {
  title: "Set template",
  submitting: "Setting…",
  success: (code: string) => `Removal template set for ${code}.`,
  failure: "The Removal template was not set. Try again.",
};

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
  /**
   * Each listed template's readiness, from Removal templates. Absent while it
   * loads or when it could not be read; the server still refuses a template
   * that is not ready.
   */
  readiness?: ReadonlyMap<string, TemplateReadiness>;
  readinessLoading?: boolean;
}

export interface TemplateReadiness {
  ready: boolean;
  /** Why it cannot be chosen yet: "3 lines to decide", "Not set up yet". */
  reason?: string;
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
  readiness,
  readinessLoading = false,
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
  const copy = creditBatch.removalTemplateId ? SWITCH_COPY : SET_COPY;

  // Only Removal templates can be pinned; the action refuses anything else.
  const removalTemplates = (templates ?? []).filter((template) => template.credit_type === "REMOVAL");
  const notReady = removalTemplates.flatMap((template) => {
    const state = readiness?.get(template.id);
    return state && !state.ready && template.id !== creditBatch.removalTemplateId
      ? [{ template, reason: state.reason }] : [];
  });
  const notReadyIds = new Set(notReady.map(({ template }) => template.id));
  const options = removalTemplates.map((template) => {
    const current = template.id === creditBatch.removalTemplateId;
    const notes = [
      current ? "Current template" : template.id === defaultTemplateId ? "Facility default" : undefined,
      notReadyIds.has(template.id) ? readiness?.get(template.id)?.reason : undefined,
    ].filter(Boolean);
    return {
      id: template.id,
      code: template.id,
      name: template.display_name,
      subtitle: notes.length ? notes.join(", ") : undefined,
      disabled: notReadyIds.has(template.id),
    };
  });
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
      toast.success(copy.success(creditBatch.code));
      onClose();
    } catch (error) {
      if (getStaleVersionConflict(error)) {
        setStale(true);
        onStale?.();
      }
      setError("root.serverError", {
        type: "server",
        message: toSaveErrorMessage(error, copy.failure),
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-24">
      <header className="flex flex-col gap-4">
        <h2 id={DIALOG_TITLE_ID} className="title-heading-3">{copy.title}</h2>
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
          isLoading={templatesLoading || readinessLoading}
          disabled={!!unavailableReason}
          loadError={options.length === 0 ? templatesError : null}
          error={!!errors.removalTemplateId}
          value={field.value}
          onChange={(value) => field.onChange(value ?? "")}
          onBlur={field.onBlur}
        />
      </FormField>

      {!unavailableReason && notReady.length > 0 && (
        <Notice tone="info" title="Not ready for credit batches">
          <ul className="flex flex-col gap-8">
            {notReady.map(({ template, reason }) => (
              <li key={template.id} className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
                <span className="body-small text-[var(--color-text-primary)]">{template.display_name}</span>
                {reason && <span className="body-caption text-[var(--color-text-tertiary)]">{reason}</span>}
                {/* A new tab, so this dialog and its unsaved choice stay open. */}
                <Link
                  href={certificationRemovalTemplatesHref(creditBatch.facilityId, template.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-4 body-small underline underline-offset-2"
                >
                  {DECIDE_LINES_LINK_LABEL}
                  <ArrowSquareOutIcon size={12} aria-hidden />
                  <span className="sr-only"> {`for ${template.display_name} (opens in a new tab)`}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Notice>
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
        submitLabel={copy.title}
        submittingLabel={copy.submitting}
      />
    </form>
  );
}
