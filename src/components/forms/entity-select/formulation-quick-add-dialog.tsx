/**
 * Formulation Quick Add Dialog
 * Inline dialog for creating a formulation from an EntitySelect dropdown.
 * Embeds the full FormulationForm inside QuickAddDialogShell — a formulation is
 * a blend recipe, not a code/name pair, so the real form is the only honest one
 * to show. It opens as pure biochar (100%, no ingredients), which is the
 * formulation most quick-adds want.
 *
 * `lg` rather than the default `md`: the form's ingredient rows are a
 * material + share pair per line and wrap badly at 560px.
 */
"use client";

import { createFormulationFn } from "@/fn/formulations";
import { FormulationForm } from "@/components/formulations";
import type { FormulationFormData } from "@/schemas/formulations";
import { useQuickAddSubmit } from "@/hooks/use-quick-add-submit";
import { QuickAddDialogShell } from "./quick-add-dialog-shell";
import type { EntityOption } from "./types";

interface FormulationQuickAddDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (entity: EntityOption) => void;
}

export function FormulationQuickAddDialog({
  isOpen,
  onClose,
  onSuccess,
}: FormulationQuickAddDialogProps) {
  const { error, isSubmitting, handleSubmit } = useQuickAddSubmit<FormulationFormData>({
    entityType: "formulation",
    // `createFormulationFn` answers with the full formulation; the select only
    // needs an option, so narrow it here rather than adding a second server
    // action that would drift from the one the Formulations page uses.
    serverFn: async (data) => {
      // `createFormulationSchema` *is* the form schema, so the form's data is
      // already the payload.
      const result = await createFormulationFn(data);
      if (!result.success) return result;
      return {
        success: true,
        data: {
          id: result.data.id,
          code: result.data.code,
          name: result.data.name,
        },
      };
    },
    onSuccess,
    onClose,
  });

  return (
    <QuickAddDialogShell
      isOpen={isOpen}
      onClose={onClose}
      title="New formulation"
      width="lg"
      testId="formulation-quick-add-dialog"
    >
      <FormulationForm
        onSubmit={handleSubmit}
        onCancel={onClose}
        isSubmitting={isSubmitting}
        errorMessage={error ?? undefined}
        submitLabel="Create formulation"
      />
    </QuickAddDialogShell>
  );
}
