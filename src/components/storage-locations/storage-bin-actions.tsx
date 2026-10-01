/**
 * StorageBinActions — View and Edit buttons for the bin chosen in a picker.
 *
 * Sits beside a storage-bin `EntitySelect` (its `trailingActions` slot) and
 * opens the storage board's own bin sheet and reconcile sheet, so a bin looks
 * and edits the same wherever it is picked. The bin is loaded on click, not on
 * selection, so a form with several pickers costs nothing until one is used.
 */
"use client";

import { EyeIcon, PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { useState, type SyntheticEvent } from "react";
import { Button } from "@/components/ui/button";
import { SideSheetActionsContext } from "@/components/ui/entity-side-sheet/side-sheet-context";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import { useLoadStorageLocation } from "@/hooks/use-storage-locations";
import { BinReconcileSheet } from "./bin-reconcile-sheet";
import { StorageBinSheet, type StorageBinSheetState } from "./storage-bin-sheet";

type OpenMode = "view" | "edit";

interface StorageBinActionsProps {
  /** The selected bin; renders nothing while the picker is empty. */
  storageLocationId?: string | null;
}

/**
 * The sheets render through portals but still sit inside the entry form in
 * the React tree, where a submit would bubble on to the entry form's own
 * `onSubmit` and save it. Stop it here.
 */
const stopSubmitBubbling = (event: SyntheticEvent) => event.stopPropagation();

export function StorageBinActions({ storageLocationId }: StorageBinActionsProps) {
  const loadStorageLocation = useLoadStorageLocation();
  const toast = useToast();
  const [loading, setLoading] = useState<OpenMode | null>(null);
  const [sheet, setSheet] = useState<StorageBinSheetState | null>(null);
  const [reconcileKind, setReconcileKind] = useState<"loss" | "count">("count");
  const [reconcilingBin, setReconcilingBin] =
    useState<StorageLocationWithFacility | null>(null);

  if (!storageLocationId) return null;

  const open = async (mode: OpenMode) => {
    setLoading(mode);
    try {
      const bin = await loadStorageLocation(storageLocationId);
      // An archived bin has no edit form; its sheet opens read-only.
      setSheet({ mode: bin.archivedAt == null ? mode : "view", entity: bin });
    } catch {
      toast.error("The storage bin could not be loaded. Try again.");
    } finally {
      setLoading(null);
    }
  };

  // Reconcile lives in its own side sheet — close the bin sheet first so the
  // two panels never stack.
  const openReconcile = (
    storageLocation: StorageLocationWithFacility,
    kind: "loss" | "count" = "count",
  ) => {
    setReconcileKind(kind);
    setSheet(null);
    setReconcilingBin(storageLocation);
  };

  return (
    <>
      <Tooltip content="View bin">
        <Button
          width="square"
          aria-label="View bin"
          busy={loading === "view"}
          disabled={loading !== null}
          onClick={() => open("view")}
          data-testid="storage-bin-view"
        >
          {loading !== "view" && <EyeIcon size={18} />}
        </Button>
      </Tooltip>
      <Tooltip content="Edit bin">
        <Button
          width="square"
          aria-label="Edit bin"
          busy={loading === "edit"}
          disabled={loading !== null}
          onClick={() => open("edit")}
          data-testid="storage-bin-edit"
        >
          {loading !== "edit" && <PencilSimpleIcon size={18} />}
        </Button>
      </Tooltip>

      <div className="contents" onSubmit={stopSubmitBubbling}>
        {/* Barrier: the reconcile forms must not cancel or report dirty
            state into the entry sheet this picker sits in. */}
        <SideSheetActionsContext.Provider value={null}>
        <StorageBinSheet
          state={sheet}
          onStateChange={setSheet}
          onReconcile={openReconcile}
        />
        <BinReconcileSheet
          key={`${reconcilingBin?.id}-${reconcileKind}`}
          initialKind={reconcileKind}
          open={!!reconcilingBin}
          onOpenChange={(isOpen) => {
            if (!isOpen) setReconcilingBin(null);
          }}
          storageLocation={reconcilingBin}
        />
        </SideSheetActionsContext.Provider>
      </div>
    </>
  );
}
