/**
 * FleetEditDialog — edit a vehicle, driver or operator by id, in the same
 * quick-add dialog the picker's "Add new" opens.
 *
 * This is the seam a picker's "Edit <name>" row calls with the selected id
 * (issue #951). It reads the record fresh each time it opens and shows the
 * form only once that read has settled, so the save carries the current row
 * version rather than a cached one. Callers that already hold the record pass
 * it straight to `VehicleQuickAddDialog` / `DriverQuickAddDialog` /
 * `OperatorQuickAddDialog` instead.
 */
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useFleetRecord, type FleetRecords } from "@/hooks/use-fleet";
import type { FleetKind } from "@/lib/fleet/messages";
import { ServerError } from "../server-error";
import { DriverQuickAddDialog } from "./driver-quick-add-dialog";
import { OperatorQuickAddDialog } from "./operator-quick-add-dialog";
import { QuickAddDialogShell } from "./quick-add-dialog-shell";
import { VehicleQuickAddDialog } from "./vehicle-quick-add-dialog";

const COPY: Record<FleetKind, { title: string; loadFailed: string }> = {
  vehicle: { title: "Edit vehicle", loadFailed: "The vehicle could not be loaded. Try again." },
  driver: { title: "Edit driver", loadFailed: "The driver could not be loaded. Try again." },
  operator: { title: "Edit operator", loadFailed: "The operator could not be loaded. Try again." },
};

/** True for the entity types FleetEditDialog can edit. */
export function isFleetKind(entityType: string): entityType is FleetKind {
  return entityType === "vehicle" || entityType === "driver" || entityType === "operator";
}

export interface FleetEditDialogProps {
  kind: FleetKind;
  /** The record to edit, usually the picker's selected id. */
  entityId: string | null | undefined;
  isOpen: boolean;
  onClose: () => void;
}

interface OpenSession {
  isOpen: boolean;
  /** `dataUpdatedAt` when the dialog opened: a cached row, not the fresh read. */
  openedAt: number;
}

export function FleetEditDialog({ kind, entityId, isOpen, onClose }: FleetEditDialogProps) {
  const query = useFleetRecord(kind, entityId, isOpen);
  const [session, setSession] = useState<OpenSession>({ isOpen, openedAt: query.dataUpdatedAt });

  let current = session;
  if (isOpen !== session.isOpen) {
    // Opening starts a session that waits for a read newer than any cached
    // row; closing keeps the session so the form stays while it closes.
    current = isOpen ? { isOpen, openedAt: query.dataUpdatedAt } : { ...session, isOpen };
    setSession(current);
  }

  // Once the opening read lands, the form keeps that row for the session: a
  // later refetch never reaches it (see useOpenSnapshot in the dialogs).
  const fresh = query.dataUpdatedAt > current.openedAt;
  const record = fresh && query.data?.id === entityId ? query.data : undefined;

  if (!record) {
    return (
      <QuickAddDialogShell isOpen={isOpen} onClose={onClose} title={COPY[kind].title} testId={`${kind}-edit-dialog-loading`}>
        {query.isError ? (
          <ServerError
            message={COPY[kind].loadFailed}
            action={<Button size="small" onClick={() => { void query.refetch(); }}>Try again</Button>}
          />
        ) : (
          <Skeleton className="h-320 w-full" />
        )}
      </QuickAddDialogShell>
    );
  }

  switch (kind) {
    case "vehicle":
      return <VehicleQuickAddDialog isOpen={isOpen} onClose={onClose} vehicle={record as FleetRecords["vehicle"]} />;
    case "driver":
      return <DriverQuickAddDialog isOpen={isOpen} onClose={onClose} driver={record as FleetRecords["driver"]} />;
    case "operator":
      return <OperatorQuickAddDialog isOpen={isOpen} onClose={onClose} operator={record as FleetRecords["operator"]} />;
  }
}
