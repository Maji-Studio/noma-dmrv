"use client";

import type { FleetKind } from "@/lib/fleet/messages";
import { EntityEditDialog, type EntityEditDialogProps } from "./entity-edit-dialog";

/** Compatibility entry point for fleet consumers; all loading is shared. */
export function isFleetKind(entityType: string): entityType is FleetKind {
  return entityType === "vehicle" || entityType === "driver" || entityType === "operator";
}

export interface FleetEditDialogProps extends Omit<EntityEditDialogProps, "entityType"> {
  kind: FleetKind;
}

export function FleetEditDialog({ kind, ...props }: FleetEditDialogProps) {
  return <EntityEditDialog entityType={kind} {...props} />;
}
