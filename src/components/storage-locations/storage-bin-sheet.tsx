/**
 * StorageBinSheet — the storage bin's view / edit / create side sheet.
 *
 * One sheet for every place a bin opens: the storage board and the bin pickers
 * in entry forms (`StorageBinActions`). The caller owns which bin is open and
 * in which mode; the sheet owns the save, its error, and the success toast.
 * Reconcile stays with the caller, because it closes this sheet and opens its
 * own so the two panels never stack.
 */
"use client";

import {
  EntitySideSheet,
  type SideSheetMode,
} from "@/components/ui/entity-side-sheet";
import { useToast } from "@/components/ui/toast";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import type { StorageLocation } from "@/db/schema";
import {
  useCreateStorageLocation,
  useUpdateStorageLocation,
} from "@/hooks/use-storage-locations";
import { toSaveErrorMessage } from "@/lib/stale-version";
import type { StorageLocationFormData } from "@/schemas/storage-locations";
import { useState } from "react";
import { StorageLocationForm } from "./storage-location-form";
import { storageLocationSheetSections } from "./storage-location-read-sections";

export type StorageBinSheetState =
  | { mode: "create"; entity: null }
  | { mode: "view"; entity: StorageLocationWithFacility }
  | { mode: "edit"; entity: StorageLocationWithFacility };

interface StorageBinSheetProps {
  state: StorageBinSheetState | null;
  onStateChange: (state: StorageBinSheetState | null) => void;
  onReconcile: (
    storageLocation: StorageLocationWithFacility,
    kind?: "loss" | "count",
  ) => void;
}

export function StorageBinSheet({
  state,
  onStateChange,
  onReconcile,
}: StorageBinSheetProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const createStorageLocation = useCreateStorageLocation();
  const updateStorageLocation = useUpdateStorageLocation();
  const toast = useToast();

  const close = () => {
    onStateChange(null);
    setFormError(null);
  };

  const handleCreate = async (data: StorageLocationFormData) => {
    setFormError(null);
    try {
      await createStorageLocation.mutateAsync(data);
      onStateChange(null);
      toast.success("Storage bin created.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Storage bin was not created. Check the form.");
    }
  };

  const handleUpdate = async (data: StorageLocationFormData) => {
    if (state?.mode !== "edit") return;
    setFormError(null);
    try {
      await updateStorageLocation.mutateAsync({
        storageLocationId: state.entity.id,
        // The version the side sheet opened on, never a refetched one, so a
        // concurrent edit is refused instead of silently overwritten (#768).
        expectedUpdatedAt: state.entity.updatedAt,
        ...data,
      });
      onStateChange(null);
      toast.success("Storage bin updated.");
    } catch (error) {
      // The side sheet stays open on every failure, so the operator's draft
      // survives an expected-version refusal untouched.
      setFormError(toSaveErrorMessage(error, "Storage bin was not saved. Try again."));
    }
  };

  const handleModeChange = (mode: SideSheetMode) => {
    if (!state || !state.entity) return;
    setFormError(null);
    onStateChange({ mode: mode === "edit" ? "edit" : "view", entity: state.entity });
  };

  const editingEntity = state?.mode === "edit" ? state.entity : null;
  const isSubmitting = createStorageLocation.isPending || updateStorageLocation.isPending;

  return (
    <EntitySideSheet
      open={!!state}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      mode={state?.mode ?? "create"}
      onModeChange={handleModeChange}
      // No detail toggle: a bin sheet has no explanation to switch on, since
      // a mix bin's batch shares are data and show at every level.
      // Bins lead with their name, not their code — the one entity where the
      // house convention (code as the sheet title) puts an opaque lookup key
      // where the operator's own word for the thing belongs. The code stays,
      // small, on the line beneath.
      title={state?.mode === "create" ? "Create storage bin" : state?.entity?.name ?? ""}
      subtitle={state?.mode === "create" ? undefined : state?.entity?.code}
      editLabel="Edit storage bin"
      canEdit={state?.entity?.archivedAt == null}
      sections={
        state?.mode === "view" && state.entity
          ? storageLocationSheetSections(state.entity, onReconcile)
          : undefined
      }
    >
      <StorageLocationForm
        key={editingEntity?.id ?? "create"}
        storageLocation={editingEntity as StorageLocation | undefined}
        onSubmit={state?.mode === "edit" ? handleUpdate : handleCreate}
        onCancel={close}
        isSubmitting={isSubmitting}
        errorMessage={formError ?? undefined}
        submitLabel={state?.mode === "edit" ? "Save changes" : "Create storage bin"}
      />
    </EntitySideSheet>
  );
}
