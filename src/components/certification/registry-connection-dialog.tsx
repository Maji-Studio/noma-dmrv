"use client";

import { useContext } from "react";
import { FormDialogContext } from "@/components/ui/form-dialog-context";
import { FormDialog } from "@/components/ui/form-dialog";
import { CertifierSettingsPanel } from "./certifier-settings-panel";

export function RegistryConnectionDialog({
  facilityId,
  facilityLabel,
  onClose,
  canManage,
}: {
  facilityId: string;
  facilityLabel?: string;
  onClose: () => void;
  canManage: boolean;
}) {
  return (
    <FormDialog
      isOpen
      onClose={onClose}
      ariaLabelledBy="registry-connection-title"
      width="lg"
      discardDescription="Choose Keep editing to save your keys or link your project. Choose Discard changes to close without saving."
    >
      <RegistryConnectionContent facilityId={facilityId} facilityLabel={facilityLabel} canManage={canManage} />
    </FormDialog>
  );
}

function RegistryConnectionContent({ facilityId, facilityLabel, canManage }: {
  facilityId: string;
  facilityLabel?: string;
  canManage: boolean;
}) {
  const dialogActions = useContext(FormDialogContext);
  return (
    <div className="flex flex-col gap-24">
      <h2 id="registry-connection-title" className="title-heading-3">Connect your registry</h2>
      <CertifierSettingsPanel
        facilityId={facilityId}
        facilityLabel={facilityLabel}
        canManage={canManage}
        projectLinkPresentation="inline"
        onProjectLinked={dialogActions?.cancel}
      />
    </div>
  );
}
