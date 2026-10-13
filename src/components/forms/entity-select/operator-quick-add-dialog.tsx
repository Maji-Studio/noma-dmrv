/**
 * Operator Quick Add Dialog
 * Inline dialog for adding an operator from the EntitySelect dropdown, and for
 * editing one when `operator` is passed (the picker's edit action and the
 * settings list). Embeds the full OperatorForm inside QuickAddDialogShell.
 */
"use client";

import { useState } from "react";
import { createOperatorFn } from "@/fn/quick-add";
import { OperatorForm } from "@/components/operators/operator-form";
import type { Operator } from "@/db/schema";
import type { OperatorFormData } from "@/schemas/operators";
import { useQuickAddSubmit } from "@/hooks/use-quick-add-submit";
import { useUpdateOperator } from "@/hooks/use-fleet";
import { useOpenSnapshot } from "@/hooks/use-open-snapshot";
import { toSaveErrorMessage } from "@/lib/stale-version";
import { QuickAddDialogShell, stopSubmitBubbling } from "./quick-add-dialog-shell";
import type { EntityOption } from "./types";

interface OperatorQuickAddDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the created operator. Not called after an edit. */
  onSuccess?: (entity: EntityOption) => void;
  /** Edit this operator instead of creating one. */
  operator?: Operator | null;
}

const OPERATOR_NOT_SAVED = "The operator was not saved. Try again.";

function toOperatorPayload(data: OperatorFormData) {
  return {
    name: data.name.trim(),
    credentials: data.credentials?.trim() || null,
    contactPhone: data.contactPhone?.trim() || null,
  };
}

export function OperatorQuickAddDialog({
  isOpen,
  onClose,
  onSuccess,
  operator: operatorProp,
}: OperatorQuickAddDialogProps) {
  const create = useQuickAddSubmit<OperatorFormData>({
    entityType: "operator",
    serverFn: (data) => createOperatorFn(toOperatorPayload(data)),
    onSuccess: (entity) => onSuccess?.(entity),
    onClose,
  });
  // Hold the opened record and its version still while the dialog is open,
  // so a refetch cannot remount the form and drop the draft.
  const { snapshot: operator, sessionKey } = useOpenSnapshot(isOpen, operatorProp);
  const update = useUpdateOperator();
  const [editError, setEditError] = useState<string | null>(null);

  const handleEdit = async (data: OperatorFormData) => {
    if (!operator) return;
    setEditError(null);
    try {
      await update.mutateAsync({
        ...toOperatorPayload(data),
        operatorId: operator.id,
        expectedVersion: operator.version,
      });
      onClose();
    } catch (error) {
      setEditError(toSaveErrorMessage(error, OPERATOR_NOT_SAVED));
    }
  };

  const isEdit = Boolean(operator);
  const isSubmitting = isEdit ? update.isPending : create.isSubmitting;
  const error = isEdit ? editError : create.error;

  return (
    <QuickAddDialogShell
      isOpen={isOpen}
      onClose={onClose}
      onOpen={() => setEditError(null)}
      title={isEdit ? "Edit operator" : "New operator"}
      width="sm"
      testId={isEdit ? "operator-edit-dialog" : "operator-quick-add-dialog"}
      dismissible={!isSubmitting}
    >
      <div className="contents" onSubmit={stopSubmitBubbling}>
        <OperatorForm
          key={sessionKey}
          operator={operator ?? undefined}
          onSubmit={isEdit ? handleEdit : create.handleSubmit}
          onCancel={onClose}
          isSubmitting={isSubmitting}
          errorMessage={error ?? undefined}
          submitLabel={isEdit ? "Save operator" : "Create operator"}
        />
      </div>
    </QuickAddDialogShell>
  );
}
