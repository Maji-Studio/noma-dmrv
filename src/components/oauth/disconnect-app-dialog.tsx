"use client";

import { useState } from "react";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { useRevokeOAuthGrant, type OAuthGrantListItem } from "@/hooks/use-oauth-grants";
import { oauthAppName } from "./oauth-labels";
import { toSaveErrorMessage } from "@/lib/stale-version";

export function DisconnectAppDialog({ grant, organizationId, organizationName, onClose }: {
  grant: OAuthGrantListItem;
  organizationId: string;
  organizationName: string;
  onClose: () => void;
}) {
  const revoke = useRevokeOAuthGrant(organizationId);
  const [error, setError] = useState("");
  const close = () => { if (!revoke.isPending) onClose(); };

  async function confirm() {
    setError("");
    try { await revoke.mutateAsync({ id: grant.id, expectedVersion: grant.version }); onClose(); }
    catch (failure) { setError(toSaveErrorMessage(failure, "The app was not disconnected. Try again.")); }
  }

  return (
    <DeleteConfirmDialog
      isOpen
      title="Disconnect app"
      message={`Disconnect ${oauthAppName(grant.name)}? It stops working in ${organizationName} at once. Records it saved stay.`}
      onConfirm={confirm}
      onCancel={close}
      isPending={revoke.isPending}
      errorMessage={error}
      confirmLabel="Disconnect"
      pendingLabel="Disconnecting..."
    />
  );
}
