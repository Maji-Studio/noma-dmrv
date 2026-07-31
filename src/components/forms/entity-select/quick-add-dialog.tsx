/**
 * Quick Add Dialog
 * Generic dialog for quickly adding new entities from the EntitySelect dropdown
 */
"use client";

import { useState, useCallback } from "react";
import { Modal } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { ServerError } from "@/components/forms/server-error";
import type { QuickAddDialogProps, EntityOption } from "./types";
import { ENTITY_TYPE_LABELS } from "./entity-labels";


interface QuickAddForm {
  code: string;
  name: string;
}

interface QuickAddDialogInternalProps extends QuickAddDialogProps {
  /** Async function to create the entity */
  onSubmit: (data: QuickAddForm) => Promise<EntityOption>;
  /** Whether the form is submitting */
  isSubmitting?: boolean;
}

/**
 * QuickAddDialog component
 * Renders a modal dialog for quickly creating a new entity
 *
 * Note: This component is designed to be customized per entity type.
 * Use the `children` prop or create entity-specific quick add dialogs
 * that extend this base component.
 */
export function QuickAddDialog({
  isOpen,
  onClose,
  onSuccess,
  entityType,
  onSubmit,
  isSubmitting = false,
}: QuickAddDialogInternalProps) {
  const [formData, setFormData] = useState<QuickAddForm>({ code: "", name: "" });
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setFormData({ code: "", name: "" });
    setError(null);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Basic validation (code is optional - auto-generated if empty)
    if (!formData.name.trim()) {
      setError("Name is required");
      return;
    }

    try {
      const newEntity = await onSubmit(formData);
      onSuccess(newEntity);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Record was not created. Check the form.");
    }
  };

  const entityLabel = ENTITY_TYPE_LABELS[entityType] || entityType;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      onOpen={resetForm}
      ariaLabelledBy="quick-add-dialog-title"
      width="sm"
      // Inset header has its own padding + bottom border that must reach the
      // dialog edges, so we opt out of Modal's default content padding.
      contentClassName=""
    >
      <div className="flex flex-col">
        {/* Header */}
        <div className="flex items-center p-24 border-b border-[var(--color-border-primary)]">
          <h2 id="quick-add-dialog-title" className="title-heading-3">
            New {entityLabel}
          </h2>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-24 p-24">
          <ServerError message={error ?? undefined} />

          <div className="flex flex-col gap-6">
            <label htmlFor="quick-add-code" className="body-small font-medium text-[var(--color-text-secondary)]">
              Code
            </label>
            <input
              id="quick-add-code"
              type="text"
              value={formData.code}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, code: e.target.value }))
              }
              placeholder="Auto-generated if empty"
              className="flex h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-colors placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-6">
            <label htmlFor="quick-add-name" className="body-small font-medium text-[var(--color-text-secondary)]">
              Name <span className="text-[var(--color-signal-red)]">*</span>
            </label>
            <input
              id="quick-add-name"
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder={`Enter ${entityLabel} name`}
              className="flex h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-colors placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-16 justify-start pt-16">
            <Button type="submit" variant="primary" busy={isSubmitting}>
              Create {entityLabel}
            </Button>
            <Button
              variant="default"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

/**
 * Hook for managing quick-add dialog state
 */
export function useQuickAddDialog() {
  const [isOpen, setIsOpen] = useState(false);

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };
}
