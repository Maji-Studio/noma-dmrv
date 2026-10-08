"use client";

import { useState } from "react";
import { KeyIcon } from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms";
import { Button, EmptyState, Notice } from "@/components/ui";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useApiKeys, type ApiKeyListItem } from "@/hooks/use-api-keys";
import { ApiKeyList } from "./api-key-list";
import { CreateApiKeyDialog } from "./create-api-key-dialog";
import { EditApiKeyDialog } from "./edit-api-key-dialog";
import { RevokeApiKeyDialog } from "./revoke-api-key-dialog";

const EMPTY_ICON_SIZE = 32;
export function ApiKeySettings({ canManage, organizationId }: { canManage: boolean; organizationId: string }) {
  if (!canManage) {
    return <Notice tone="info">Only organization Owners and Admins with a membership can manage API keys. Ask one to make changes.</Notice>;
  }
  return <ApiKeyManager key={organizationId} organizationId={organizationId} />;
}

function ApiKeyManager({ organizationId }: { organizationId: string }) {
  const query = useApiKeys(organizationId);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ApiKeyListItem | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyListItem | null>(null);

  return (
    <div className="flex flex-col gap-20">
      <div className="flex flex-col gap-20">
        {query.isLoading && !query.data ? <Skeleton className="h-320 w-full" /> : query.isError ? (
          <ServerError message="API keys could not be loaded. Check your organization role and try again." action={<Button onClick={() => { void query.refetch(); }}>Try again</Button>} />
        ) : query.data ? (
          <>
            <div><Button variant="primary" onClick={() => setCreateOpen(true)}>New API key</Button></div>
            {query.data.length === 0 ? (
              <EmptyState icon={<KeyIcon size={EMPTY_ICON_SIZE} />} title="No API keys yet" padding="sm" action={<Button onClick={() => setCreateOpen(true)}>Create your first API key</Button>} />
            ) : <ApiKeyList keys={query.data} onEdit={setEditing} onRevoke={setRevoking} />}
          </>
        ) : null}
      </div>
      {/* A failed follow-up list read must not discard a newly issued secret. */}
      <CreateApiKeyDialog isOpen={createOpen} onClose={() => setCreateOpen(false)} organizationId={organizationId} />
      <EditApiKeyDialog apiKey={editing} onClose={() => setEditing(null)} organizationId={organizationId} />
      {revoking && <RevokeApiKeyDialog apiKey={revoking} onClose={() => setRevoking(null)} organizationId={organizationId} />}
    </div>
  );
}
