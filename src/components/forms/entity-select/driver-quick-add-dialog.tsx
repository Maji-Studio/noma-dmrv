/**
 * Driver Quick Add Dialog
 * Inline dialog for adding a driver from the EntitySelect dropdown, and for
 * editing one when `driver` is passed (the picker's edit action and the
 * settings list). Embeds the full DriverForm inside QuickAddDialogShell.
 */
"use client";

import { useState } from "react";
import { createDriverFn } from "@/fn/quick-add";
import { DriverForm } from "@/components/drivers/driver-form";
import type { Driver } from "@/db/schema";
import type { DriverFormData } from "@/schemas/drivers";
import { useQuickAddSubmit } from "@/hooks/use-quick-add-submit";
import { useUpdateDriver } from "@/hooks/use-fleet";
import { useOpenSnapshot } from "@/hooks/use-open-snapshot";
import { toSaveErrorMessage } from "@/lib/stale-version";
import { QuickAddDialogShell, stopSubmitBubbling } from "./quick-add-dialog-shell";
import type { EntityOption } from "./types";

interface DriverQuickAddDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the created driver. Not called after an edit. */
  onSuccess?: (entity: EntityOption) => void;
  /** Edit this driver instead of creating one. */
  driver?: Driver | null;
}

const DRIVER_NOT_SAVED = "The driver was not saved. Try again.";

function toDriverPayload(data: DriverFormData) {
  return {
    name: data.name.trim(),
    licenseNumber: data.licenseNumber?.trim() || null,
    contactPhone: data.contactPhone?.trim() || null,
  };
}

export function DriverQuickAddDialog({
  isOpen,
  onClose,
  onSuccess,
  driver: driverProp,
}: DriverQuickAddDialogProps) {
  const create = useQuickAddSubmit<DriverFormData>({
    entityType: "driver",
    serverFn: (data) => createDriverFn(toDriverPayload(data)),
    onSuccess: (entity) => onSuccess?.(entity),
    onClose,
  });
  // Hold the opened record and its version still while the dialog is open,
  // so a refetch cannot remount the form and drop the draft.
  const { snapshot: driver, sessionKey } = useOpenSnapshot(isOpen, driverProp);
  const update = useUpdateDriver();
  const [editError, setEditError] = useState<string | null>(null);

  const handleEdit = async (data: DriverFormData) => {
    if (!driver) return;
    setEditError(null);
    try {
      await update.mutateAsync({
        ...toDriverPayload(data),
        driverId: driver.id,
        expectedVersion: driver.version,
      });
      onClose();
    } catch (error) {
      setEditError(toSaveErrorMessage(error, DRIVER_NOT_SAVED));
    }
  };

  const isEdit = Boolean(driver);
  const isSubmitting = isEdit ? update.isPending : create.isSubmitting;
  const error = isEdit ? editError : create.error;

  return (
    <QuickAddDialogShell
      isOpen={isOpen}
      onClose={onClose}
      onOpen={() => setEditError(null)}
      title={isEdit ? "Edit driver" : "New driver"}
      width="sm"
      testId={isEdit ? "driver-edit-dialog" : "driver-quick-add-dialog"}
      dismissible={!isSubmitting}
    >
      <div className="contents" onSubmit={stopSubmitBubbling}>
        <DriverForm
          key={sessionKey}
          driver={driver ?? undefined}
          onSubmit={isEdit ? handleEdit : create.handleSubmit}
          onCancel={onClose}
          isSubmitting={isSubmitting}
          errorMessage={error ?? undefined}
          submitLabel={isEdit ? "Save driver" : "Create driver"}
        />
      </div>
    </QuickAddDialogShell>
  );
}
