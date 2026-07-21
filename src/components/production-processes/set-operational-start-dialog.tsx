/**
 * SetOperationalStartDialog — correct a production process's operational start
 * (`established_at`) so a back-entered facility whose real sampling predates the
 * auto-created process can reach Method B (ADR 0017, 2026-07-12 amendment).
 *
 * Owners/admins only (the caller gates the affordance on `canManage`; the server
 * action re-checks the role). Editable only while the process is still on Method
 * A — once Method B unlocks the baseline window is fixed history and the server
 * rejects the change; the caller never opens this dialog for an unlocked process.
 */
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Modal } from "@/components/ui";
import { FormActions, FormField, FormInput, ServerError } from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import { useSetProcessOperationalStart } from "@/hooks/use-production-processes";
import { setOperationalStartSchema } from "@/schemas/production-process";
import { formatLocalDate, toDateInputValue } from "@/lib/date-utils";
import type { ProductionProcessSummary } from "@/data-access/production-processes";

const TITLE_ID = "set-operational-start-title";

interface SetOperationalStartDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The process being corrected. Null while no row is selected. */
  process: ProductionProcessSummary | null;
}

export function SetOperationalStartDialog({
  isOpen,
  onClose,
  process,
}: SetOperationalStartDialogProps) {
  const toast = useToast();
  const setStart = useSetProcessOperationalStart();
  const today = formatLocalDate(new Date());

  const defaultValues = {
    processId: process?.id ?? "",
    establishedAt: toDateInputValue(process?.establishedAt),
  };

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(setOperationalStartSchema),
    defaultValues,
  });

  const onSubmit = handleSubmit(async (data) => {
    try {
      await setStart.mutateAsync(data);
      toast.success("Operational start updated");
      onClose();
    } catch (error) {
      setError("root.serverError", {
        type: "server",
        message:
          error instanceof Error
            ? error.message
            : "Failed to update the operational start",
      });
    }
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      onOpen={() => reset(defaultValues)}
      ariaLabelledBy={TITLE_ID}
      width="md"
      dismissOnClickOutside={false}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-24">
        <header className="flex flex-col gap-4">
          <h2 id={TITLE_ID} className="title-heading-3">
            Set operational start
          </h2>
          <p className="body-small text-[var(--color-text-secondary)]">
            {process
              ? `${process.feedstockName} (${process.feedstockCode}) — the date this process began operating.`
              : "The date this production process began operating."}
          </p>
        </header>

        {errors.root?.serverError?.message && (
          <ServerError message={errors.root.serverError.message} />
        )}

        <FormField
          id="establishedAt"
          label="Operational start"
          required
          error={errors.establishedAt?.message}
          hint="Samples dated before this day never count toward the Method-B baseline. Correct it to the true start so back-entered samples qualify. Can't be changed once Method B is unlocked."
        >
          <FormInput
            id="establishedAt"
            type="date"
            max={today}
            error={!!errors.establishedAt}
            {...register("establishedAt")}
          />
        </FormField>

        <FormActions
          onCancel={onClose}
          isSubmitting={isSubmitting || setStart.isPending}
          submitLabel="Save operational start"
        />
      </form>
    </Modal>
  );
}
