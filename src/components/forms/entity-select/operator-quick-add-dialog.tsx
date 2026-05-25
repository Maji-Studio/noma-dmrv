/**
 * Operator Quick Add Dialog
 * Inline dialog for quickly adding new operators from EntitySelect dropdown.
 * Embeds the full OperatorForm inside QuickAddDialogShell.
 */
"use client";

import { createOperatorFn } from "@/fn/quick-add";
import { OperatorForm } from "@/components/operators/operator-form";
import type { OperatorFormData } from "@/schemas/operators";
import { useQuickAddSubmit } from "@/hooks/use-quick-add-submit";
import { QuickAddDialogShell } from "./quick-add-dialog-shell";
import type { EntityOption } from "./types";

interface OperatorQuickAddDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (entity: EntityOption) => void;
}

export function OperatorQuickAddDialog({
  isOpen,
  onClose,
  onSuccess,
}: OperatorQuickAddDialogProps) {
  const { error, isSubmitting, handleSubmit } = useQuickAddSubmit<OperatorFormData>({
    entityType: "operator",
    serverFn: (data) =>
      createOperatorFn({
        name: data.name.trim(),
        credentials: data.credentials?.trim() || null,
        contactPhone: data.contactPhone?.trim() || null,
      }),
    onSuccess,
    onClose,
  });

  return (
    <QuickAddDialogShell
      isOpen={isOpen}
      onClose={onClose}
      title="Add New Operator"
      error={error}
      width="sm"
      testId="operator-quick-add-dialog"
    >
      <OperatorForm
        onSubmit={handleSubmit}
        onCancel={onClose}
        isSubmitting={isSubmitting}
        submitLabel="Create Operator"
      />
    </QuickAddDialogShell>
  );
}
