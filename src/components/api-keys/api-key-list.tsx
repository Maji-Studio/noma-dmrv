"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui";
import type { ApiKeyListItem } from "@/hooks/use-api-keys";
import { scopesFromPermissions } from "@/lib/auth/api-scopes";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatDateTime } from "@/lib/format-utils";
import { permissionSummary } from "./api-key-permissions";

function keyStatus(key: ApiKeyListItem) {
  if (!key.enabled) return "disabled";
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) return "expired";
  return "active";
}

export function ApiKeyList({ keys, onEdit, onRevoke }: {
  keys: ApiKeyListItem[];
  onEdit: (key: ApiKeyListItem) => void;
  onRevoke: (key: ApiKeyListItem) => void;
}) {
  return (
    <ul className="flex flex-col gap-16" aria-label="API keys">
      {keys.map((key) => {
        const status = keyStatus(key);
        const name = key.name || MISSING_VALUE.notSet;
        return (
          <li key={key.id} className="border border-[var(--color-border-secondary)] p-16 flex flex-col gap-12">
            <div className="flex flex-wrap items-center justify-between gap-12">
              <h3 className="body-medium font-medium break-words">{name}</h3>
              <StatusBadge status={status} />
            </div>
            <dl className="grid grid-cols-1 gap-12 sm:grid-cols-2 body-small">
              <div><dt className="text-[var(--color-text-tertiary)]">Owner</dt><dd>{key.ownerName}</dd></div>
              <div><dt className="text-[var(--color-text-tertiary)]">Created</dt><dd>{formatDateTime(key.createdAt)}</dd></div>
              <div><dt className="text-[var(--color-text-tertiary)]">Last used</dt><dd>{formatDateTime(key.lastUsedAt)}</dd></div>
              <div><dt className="text-[var(--color-text-tertiary)]">Expires</dt><dd>{formatDateTime(key.expiresAt)}</dd></div>
              <div className="sm:col-span-2"><dt className="text-[var(--color-text-tertiary)]">Permissions</dt><dd>{permissionSummary(scopesFromPermissions(key.permissions))}</dd></div>
            </dl>
            {status === "active" && (
              <div className="flex flex-wrap gap-12">
                <Button aria-label={`Edit ${name}`} onClick={() => onEdit(key)}>Edit</Button>
                <Button variant="destructive" aria-label={`Revoke ${name}`} onClick={() => onRevoke(key)}>Revoke</Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
