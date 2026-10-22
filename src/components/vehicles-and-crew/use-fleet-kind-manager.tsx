/**
 * One kind's list state on the Vehicles and crew page: its records, the side
 * sheet (view, edit, create) and the delete confirmation. A layout calls it
 * once per kind, places the table wherever it likes and mounts `overlays`.
 */
"use client";

import { useState, type ReactNode } from "react";
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

export function useFleetKindManager<K extends FleetKind>(kind: K): FleetKindManager<K> {
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

  const openCreate = () => setSheet({ record: null, mode: "create" });
  const openView = (record: FleetRecords[K]) => setSheet({ record, mode: "view" });
  const openEdit = (record: FleetRecords[K]) => setSheet({ record, mode: "edit" });
  const closeSheet = () => setSheet(null);

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
      if (sheet?.record?.id === deleting.id) setSheet(null);
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
