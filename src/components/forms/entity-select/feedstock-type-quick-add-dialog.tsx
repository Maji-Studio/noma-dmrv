/**
 * Feedstock Type Quick Add Dialog
 * Inline dialog for quickly adding new feedstock types from EntitySelect dropdown
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { createFeedstockTypeFn } from "@/fn/quick-add";
import type { EntityOption } from "./types";

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

interface FeedstockTypeQuickAddDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (entity: EntityOption) => void;
}

interface FeedstockTypeForm {
  code: string;
  name: string;
  category: string;
  description: string;
  registryUrl: string;
}

const FEEDSTOCK_CATEGORIES = [
  { value: "forestry", label: "Forestry" },
  { value: "agricultural", label: "Agricultural" },
  { value: "industrial", label: "Industrial" },
  { value: "municipal", label: "Municipal" },
  { value: "invasive", label: "Invasive Species" },
];

export function FeedstockTypeQuickAddDialog({
  isOpen,
  onClose,
  onSuccess,
}: FeedstockTypeQuickAddDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [formData, setFormData] = useState<FeedstockTypeForm>({
    code: "",
    name: "",
    category: "",
    description: "",
    registryUrl: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Handle dialog open/close with native dialog API
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      setFormData({
        code: "",
        name: "",
        category: "",
        description: "",
        registryUrl: "",
      });
      setError(null);
      setIsSubmitting(false);
      dialog.showModal();
    } else {
      dialog.close();
    }
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
    setIsSubmitting(true);

    if (!formData.name.trim()) {
      setError("Name is required");
      setIsSubmitting(false);
      return;
    }
    if (!formData.category) {
      setError("Category is required");
      setIsSubmitting(false);
      return;
    }

    try {
      const result = await createFeedstockTypeFn({
        code: formData.code.trim().toUpperCase(),
        name: formData.name.trim(),
        category: formData.category,
        description: formData.description.trim() || null,
        registryUrl: formData.registryUrl.trim() || null,
      });

      if (!result.success) {
        setError(result.error);
        setIsSubmitting(false);
        return;
      }

      onSuccess(result.data);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create feedstock type"
      );
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      className="p-0 rounded-[var(--radius-8)] border border-[var(--color-border-primary)] backdrop:bg-black/50 max-w-lg w-full"
      aria-labelledby="feedstock-type-quick-add-dialog-title"
      data-testid="feedstock-type-quick-add-dialog"
    >
      <div className="flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-24 border-b border-[var(--color-border-primary)]">
          <h2
            id="feedstock-type-quick-add-dialog-title"
            className="title-heading-3"
          >
            Add New Feedstock Type
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

          <div className="grid grid-cols-2 gap-24">
            <div className="flex flex-col gap-16">
              <label htmlFor="feedstock-code" className="label-medium">
                Code <span className="text-[var(--color-signal-red)]">*</span>
              </label>
              <input
                id="feedstock-code"
                type="text"
                value={formData.code}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    code: e.target.value.toUpperCase(),
                  }))
                }
                placeholder="e.g., FST-001"
                className="flex h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-colors placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
                autoFocus
                data-testid="feedstock-code-input"
              />
            </div>

            <div className="flex flex-col gap-16">
              <label htmlFor="feedstock-category" className="label-medium">
                Category{" "}
                <span className="text-[var(--color-signal-red)]">*</span>
              </label>
              <select
                id="feedstock-category"
                value={formData.category}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, category: e.target.value }))
                }
                className="flex h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
                data-testid="feedstock-category-select"
              >
                <option value="">Select category...</option>
                {FEEDSTOCK_CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-16">
            <label htmlFor="feedstock-name" className="label-medium">
              Name <span className="text-[var(--color-signal-red)]">*</span>
            </label>
            <input
              id="feedstock-name"
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder="e.g., Mixed Wood Chips"
              className="flex h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-colors placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
              data-testid="feedstock-name-input"
            />
          </div>

          <div className="flex flex-col gap-16">
            <label htmlFor="feedstock-description" className="label-medium">
              Description
            </label>
            <textarea
              id="feedstock-description"
              value={formData.description}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, description: e.target.value }))
              }
              placeholder="Optional description of this feedstock type"
              rows={3}
              className="flex w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-16 py-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-colors placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] resize-none"
              data-testid="feedstock-description-input"
            />
          </div>

          <div className="flex flex-col gap-16">
            <label htmlFor="feedstock-registry-url" className="label-medium">
              Registry URL
            </label>
            <input
              id="feedstock-registry-url"
              type="url"
              value={formData.registryUrl}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, registryUrl: e.target.value }))
              }
              placeholder="https://isometric.registry.example/feedstock/..."
              className="flex h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-colors placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
              data-testid="feedstock-registry-url-input"
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
              data-testid="feedstock-submit-button"
            >
              {isSubmitting && <SpinnerIcon className="w-4 h-4" />}
              {isSubmitting ? "Creating..." : "Create Feedstock Type"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
