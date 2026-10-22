/**
 * One kind's list state on the Vehicles and crew page: its records, the side
 * sheet (view, edit, create) and the delete confirmation. The page calls it
 * once per kind and mounts `overlays`.
 */
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import {
  useDeleteDriver,
  useDeleteOperator,
  useDeleteVehicle,
  useFleetList,
  type FleetRecords,
} from "@/hooks/use-fleet";
import type { FleetKind } from "@/lib/fleet/messages";
import { ENTITY_DEEP_LINK_EDIT_MODE } from "@/lib/entity-deep-link";
import { toDeleteErrorMessage } from "@/lib/stale-version";
import { FLEET_KIND_COPY, fleetRecordCode, fleetRecordLabel, fleetSheetSections } from "./fleet-kinds";
import { FleetSheetForm } from "./fleet-sheet-forms";

interface SheetState<T> {
  record: T | null;
  mode: SideSheetMode;
}

export interface FleetKindManager<K extends FleetKind> {
  kind: K;
  records: FleetRecords[K][];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  openCreate: () => void;
  openView: (record: FleetRecords[K]) => void;
  openEdit: (record: FleetRecords[K]) => void;
  requestDelete: (record: FleetRecords[K]) => void;
  /** The side sheet and the delete dialog; mount once per kind. */
  overlays: ReactNode;
}

/** All three delete hooks run so the hook order never depends on the kind. */
function useFleetDelete(kind: FleetKind) {
  const vehicle = useDeleteVehicle();
  const driver = useDeleteDriver();
  const operator = useDeleteOperator();
  const run = (record: FleetRecords[FleetKind]) => {
    switch (kind) {
      case "vehicle":
        return vehicle.mutateAsync({ vehicleId: record.id, expectedVersion: record.version });
      case "driver":
        return driver.mutateAsync({ driverId: record.id, expectedVersion: record.version });
      default:
        return operator.mutateAsync({ operatorId: record.id, expectedVersion: record.version });
    }
  };
  const isPending = { vehicle, driver, operator }[kind].isPending;
  return { run, isPending };
}

export interface FleetKindManagerOptions {
  /** A record id from a deep link (`?driver=<id>`); once the list has loaded, its sheet opens. */
  linkedId?: string | null;
  /** The link's `mode`: "edit" opens the edit sheet, anything else the view sheet. */
  linkedMode?: string | null;
  /** Called when the sheet closes or the link cannot be opened, so the page can drop it from the URL. */
  onLinkClear?: () => void;
}

export function useFleetKindManager<K extends FleetKind>(
  kind: K,
  { linkedId = null, linkedMode = null, onLinkClear }: FleetKindManagerOptions = {},
): FleetKindManager<K> {
  const copy = FLEET_KIND_COPY[kind];
  const query = useFleetList(kind);
  const records = (query.data ?? []) as FleetRecords[K][];
  const remove = useFleetDelete(kind);
  const toast = useToast();

  const [sheet, setSheet] = useState<SheetState<FleetRecords[K]> | null>(null);
  // Held by id and read from the list, so a stale refusal's list refresh
  // rebinds the confirmation to the row's new version for the next attempt.
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleting = records.find((record) => record.id === deletingId) ?? null;

  // View mode reads the latest row; edit keeps the record it opened with.
  const sheetRecord = sheet?.record ?? null;
  const liveRecord = sheetRecord ? records.find((record) => record.id === sheetRecord.id) ?? sheetRecord : null;
  const shownRecord = sheet?.mode === "view" ? liveRecord : sheetRecord;

  // A deep link opens the record's view sheet once, as soon as the list has it.
  const [openedLinkId, setOpenedLinkId] = useState<string | null>(null);
  if (!linkedId && openedLinkId) setOpenedLinkId(null);
  const linked = linkedId ? records.find((record) => record.id === linkedId) : undefined;
  if (linked && !sheet && openedLinkId !== linkedId) {
    setOpenedLinkId(linkedId);
    setSheet({ record: linked, mode: linkedMode === ENTITY_DEEP_LINK_EDIT_MODE ? "edit" : "view" });
  }

  // A link to a record that is gone (deleted, other organization) says so once.
  const handledMissingRef = useRef<string | null>(null);
  // A cached list that is still refetching may lack a just-created record.
  const listLoaded = !query.isLoading && !query.isFetching && !query.error && query.data !== undefined;
  useEffect(() => {
    if (!linkedId) {
      handledMissingRef.current = null;
      return;
    }
    if (!listLoaded || linked || handledMissingRef.current === linkedId) return;
    handledMissingRef.current = linkedId;
    toast.error(`Linked ${copy.noun} could not be opened`);
    onLinkClear?.();
  }, [linkedId, listLoaded, linked, toast, copy.noun, onLinkClear]);

  const openCreate = () => setSheet({ record: null, mode: "create" });
  const openView = (record: FleetRecords[K]) => setSheet({ record, mode: "view" });
  const openEdit = (record: FleetRecords[K]) => setSheet({ record, mode: "edit" });
  const closeSheet = () => {
    setSheet(null);
    onLinkClear?.();
  };

  const closeDelete = () => {
    if (remove.isPending) return;
    setDeletingId(null);
    setDeleteError("");
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const label = fleetRecordLabel(kind, deleting);
    setDeleteError("");
    try {
      await remove.run(deleting);
      toast.success(`${label} deleted.`);
      setDeletingId(null);
      if (sheet?.record?.id === deleting.id) closeSheet();
    } catch (error) {
      setDeleteError(toDeleteErrorMessage(error, label, `${label} was not deleted. Try again.`));
    }
  };

  const mode = sheet?.mode ?? "create";
  const overlays = (
    <>
      <EntitySideSheet
        open={!!sheet}
        onOpenChange={(open) => !open && closeSheet()}
        mode={mode}
        onModeChange={(next) => setSheet((current) => (current ? { record: liveRecord, mode: next } : null))}
        title={mode === "create" ? `Create ${copy.noun}` : shownRecord?.name ?? ""}
        subtitle={mode === "create" || !shownRecord ? undefined : fleetRecordCode(shownRecord)}
        editLabel={`Edit ${copy.noun}`}
        editNotice={
          kind === "vehicle" && mode === "edit" ? (
            <Notice tone="info">
              The vehicle type applies to every feedstock intake that uses this vehicle. It cannot change while a submitted credit batch uses it.
            </Notice>
          ) : undefined
        }
        sections={shownRecord && mode === "view" ? fleetSheetSections(kind, shownRecord) : undefined}
        size="default"
      >
        <FleetSheetForm
          key={sheetRecord?.id ?? "create"}
          kind={kind}
          record={mode === "edit" ? sheetRecord : null}
          onSaved={(message) => {
            toast.success(message);
            closeSheet();
          }}
          onCancel={closeSheet}
        />
      </EntitySideSheet>

      <DeleteConfirmDialog
        isOpen={deleting !== null}
        title={`Delete ${copy.noun}`}
        message={deleting ? `Delete ${deleting.name}? This cannot be undone.` : ""}
        onConfirm={() => {
          void confirmDelete();
        }}
        onCancel={closeDelete}
        isPending={remove.isPending}
        errorMessage={deleteError || undefined}
      />
    </>
  );

  return {
    kind,
    records,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => {
      void query.refetch();
    },
    openCreate,
    openView,
    openEdit,
    requestDelete: (record) => {
      setDeleteError("");
      setDeletingId(record.id);
    },
    overlays,
  };
}
