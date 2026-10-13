"use client";

import { useState } from "react";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { useRevokeApiKey, type ApiKeyListItem } from "@/hooks/use-api-keys";
import { toSaveErrorMessage } from "@/lib/stale-version";

export function RevokeApiKeyDialog({ apiKey, onClose, organizationId }: {
  apiKey: ApiKeyListItem;
  onClose: () => void;
  organizationId: string;
}) {
  const revoke = useRevokeApiKey(organizationId);
  const [error, setError] = useState("");
  const close = () => { if (!revoke.isPending) onClose(); };

  async function confirm() {
    setError("");
    try { await revoke.mutateAsync({ id: apiKey.id, expectedVersion: apiKey.version }); onClose(); }
    catch (error) { setError(toSaveErrorMessage(error, "The API key was not revoked. Try again.")); }
  }

  return (
    <DeleteConfirmDialog
      isOpen
      title="Revoke API key"
      message={`Revoke ${apiKey.name}? This cannot be undone. Any script or integration using this key will lose access. The key stays listed as Disabled until it expires.`}
      onConfirm={confirm}
      onCancel={close}
      isPending={revoke.isPending}
      errorMessage={error}
      confirmLabel="Revoke key"
      pendingLabel="Revoking..."
    />
  );
}
