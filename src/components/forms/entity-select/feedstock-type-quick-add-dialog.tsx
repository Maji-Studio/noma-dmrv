/**
 * Feedstock Type Quick Add Dialog
 * Inline dialog for quickly adding new feedstock types from EntitySelect dropdown.
 * Embeds the full FeedstockTypeForm inside QuickAddDialogShell.
 */
"use client";

import { createFeedstockTypeFn } from "@/fn/quick-add";
import { FeedstockTypeForm } from "@/components/feedstock-types/feedstock-type-form";
import type { FeedstockTypeFormData, FeedstockTypeUsage } from "@/schemas/feedstock-types";
import { useQuickAddSubmit } from "@/hooks/use-quick-add-submit";
import { QuickAddDialogShell } from "./quick-add-dialog-shell";
import type { EntityOption } from "./types";

interface FeedstockTypeQuickAddDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (entity: EntityOption) => void;
  defaultUsage?: FeedstockTypeUsage;
}

export function FeedstockTypeQuickAddDialog({
  isOpen,
  onClose,
  onSuccess,
  defaultUsage,
}: FeedstockTypeQuickAddDialogProps) {
  const hint =
    defaultUsage === "blend"
      ? "Add an internal-only blend material such as compost, mineral, lime, binder, or another amendment. Blend materials are not submitted to the registry."
      : "Add the agricultural or forestry residue used in Dark Earth Carbon operations. The Isometric tab shows the registry's catalogue for cross-reference (read-only).";

  const { error, isSubmitting, handleSubmit } = useQuickAddSubmit<FeedstockTypeFormData>({
    entityType: "feedstockType",
    serverFn: (data) =>
      createFeedstockTypeFn({
        name: data.name.trim(),
        category: data.category,
        usage: data.usage,
        description: data.description?.trim() || null,
        registryUrl: data.registryUrl?.trim() || null,
      }),
    onSuccess,
    onClose,
  });

  return (
    <QuickAddDialogShell
      isOpen={isOpen}
      onClose={onClose}
      title="Add New Feedstock Type"
      error={error}
      testId="feedstock-type-quick-add-dialog"
    >
      <FeedstockTypeForm
        onSubmit={handleSubmit}
        onCancel={onClose}
        isSubmitting={isSubmitting}
        submitLabel="Create Feedstock Type"
        defaultUsage={defaultUsage}
        hint={hint}
      />
    </QuickAddDialogShell>
  );
}
