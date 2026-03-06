/**
 * Operator Quick Add Dialog
 * Inline dialog for quickly adding new operators from EntitySelect dropdown
 */
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDialog } from "@/hooks/use-dialog";
import { cn } from "@/lib/utils";
import { createOperatorFn } from "@/fn/quick-add";
import { seedEntityCache } from "./cache-utils";
import type { EntityOption } from "./types";

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

interface OperatorQuickAddDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (entity: EntityOption) => void;
}

interface OperatorForm {
  name: string;
  credentials: string;
  contactPhone: string;
}

export function OperatorQuickAddDialog({
  isOpen,
  onClose,
  onSuccess,
}: OperatorQuickAddDialogProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<OperatorForm>({
    name: "",
    credentials: "",
    contactPhone: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const dialogRef = useDialog(isOpen, onClose, () => {
    setFormData({ name: "", credentials: "", contactPhone: "" });
    setError(null);
    setIsSubmitting(false);
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      setError("Name is required");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const result = await createOperatorFn({
        name: formData.name.trim(),
        credentials: formData.credentials.trim() || null,
        contactPhone: formData.contactPhone.trim() || null,
      });

      if (!result.success) {
        setError(result.error);
        setIsSubmitting(false);
        return;
      }

      seedEntityCache(queryClient, "operator", result.data);

      onSuccess(result.data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create operator");
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      className="p-0 border border-[var(--color-border-primary)] backdrop:bg-black/50 max-w-md w-full m-auto"
      aria-labelledby="operator-quick-add-dialog-title"
      data-testid="operator-quick-add-dialog"
    >
      <div className="flex flex-col">
        <div className="flex items-center justify-between p-24 border-b border-[var(--color-border-primary)]">
          <h2 id="operator-quick-add-dialog-title" className="title-heading-3">
            Add New Operator
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

        <form onSubmit={handleSubmit} className="flex flex-col gap-24 p-24">
          {error && (
            <div className="px-12 py-8 bg-[var(--color-signal-red-light)] text-[var(--color-signal-red)] text-[var(--text-s)] rounded-none">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-16">
            <label htmlFor="operator-name" className="label-medium">
              Name <span className="text-[var(--color-signal-red)]">*</span>
            </label>
            <input
              id="operator-name"
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder="e.g., Jane Doe"
              className="flex h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-colors placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
              autoFocus
              data-testid="operator-name-input"
            />
          </div>

          <div className="flex flex-col gap-16">
            <label htmlFor="operator-credentials" className="label-medium">
              Credentials
            </label>
            <input
              id="operator-credentials"
              type="text"
              value={formData.credentials}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  credentials: e.target.value,
                }))
              }
              placeholder="Optional role or certification"
              className="flex h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-colors placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
              data-testid="operator-credentials-input"
            />
          </div>

          <div className="flex flex-col gap-16">
            <label htmlFor="operator-phone" className="label-medium">
              Contact Phone
            </label>
            <input
              id="operator-phone"
              type="tel"
              value={formData.contactPhone}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  contactPhone: e.target.value,
                }))
              }
              placeholder="e.g., +255 754 000 000"
              className="flex h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-colors placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
              data-testid="operator-phone-input"
            />
          </div>

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
              data-testid="operator-submit-button"
            >
              {isSubmitting && <SpinnerIcon className="w-4 h-4" />}
              {isSubmitting ? "Creating..." : "Create Operator"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
