/**
 * Quick Add Dialog
 * Generic dialog for quickly adding new entities from the EntitySelect dropdown
 */
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { QuickAddDialogProps, EntityOption, EntityType } from "./types";

// Human-readable entity type labels
const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  facility: "Facility",
  reactor: "Reactor",
  supplier: "Supplier",
  customer: "Customer",
  driver: "Driver",
  operator: "Operator",
  storageLocation: "Storage Location",
  vehicle: "Vehicle",
  feedstockType: "Feedstock Type",
  feedstock: "Feedstock",
  productionRun: "Production Run",
  formulation: "Formulation",
};

// Icon components
function XIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M15 5L5 15M5 5l10 10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("animate-spin", className)}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M8 2a6 6 0 0 1 6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [formData, setFormData] = useState<QuickAddForm>({ code: "", name: "" });
  const [error, setError] = useState<string | null>(null);

  // Reset form state
  const resetForm = useCallback(() => {
    setFormData({ code: "", name: "" });
    setError(null);
  }, []);

  // Handle dialog open/close with native dialog API
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      dialog.showModal();
      resetForm();
    } else {
      dialog.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resetForm is stable, only run on isOpen change
  }, [isOpen]);

  // Handle ESC key
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };

    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onClose]);

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
      setError(err instanceof Error ? err.message : "Failed to create entity");
    }
  };

  const entityLabel = ENTITY_TYPE_LABELS[entityType] || entityType;

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      className="p-0 rounded-[var(--radius-8)] border border-[var(--color-border-primary)] backdrop:bg-black/50 max-w-md w-full"
      aria-labelledby="quick-add-dialog-title"
    >
      <div className="flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-24 border-b border-[var(--color-border-primary)]">
          <h2 id="quick-add-dialog-title" className="title-heading-3">
            Add New {entityLabel}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-4 rounded-4 hover:bg-[var(--color-background-medium)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
            aria-label="Close dialog"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-24 p-24">
          {error && (
            <div className="px-12 py-8 bg-[var(--color-signal-red-light)] text-[var(--color-signal-red)] text-[var(--text-s)] rounded-none">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-16">
            <label htmlFor="quick-add-code" className="label-medium">
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

          <div className="flex flex-col gap-16">
            <label htmlFor="quick-add-name" className="label-medium">
              Name <span className="text-[var(--color-signal-red)]">*</span>
            </label>
            <input
              id="quick-add-name"
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder={`Enter ${entityLabel.toLowerCase()} name`}
              className="flex h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-colors placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-16 justify-end pt-16">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="h-40 px-12 border border-[var(--color-border-primary)] rounded-none hover:bg-[var(--color-background-medium)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-8 px-16 py-8 bg-[var(--color-interaction)] text-white rounded-none hover:opacity-90 disabled:opacity-50"
            >
              {isSubmitting && <SpinnerIcon className="w-4 h-4" />}
              {isSubmitting ? "Creating..." : `Create ${entityLabel}`}
            </button>
          </div>
        </form>
      </div>
    </dialog>
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
