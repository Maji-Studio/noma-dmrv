"use client";

import { OrganizationRosterDetails, OrganizationRosterList, OrganizationRosterRow } from "@/components/organizations/organization-roster-list";
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
    <OrganizationRosterList label="API keys">
      {keys.map((key) => {
        const status = keyStatus(key);
        const name = key.name || MISSING_VALUE.notSet;
        return (
          <OrganizationRosterRow
            key={key.id}
            primary={name}
            actions={
              <>
                <StatusBadge status={status} />
                {status === "active" && (
                  <>
                    <Button variant="weak" size="small" aria-label={`Edit ${name}`} onClick={() => onEdit(key)}>Edit</Button>
                    <Button variant="destructive" size="small" aria-label={`Revoke ${name}`} onClick={() => onRevoke(key)}>Revoke</Button>
                  </>
                )}
              </>
            }
            details={
              <OrganizationRosterDetails items={[
                { label: "Owner", value: key.ownerName },
                { label: "Permissions", value: permissionSummary(scopesFromPermissions(key.permissions)) },
                { label: "Created", value: formatDateTime(key.createdAt) },
                { label: "Last used", value: formatDateTime(key.lastUsedAt) },
                { label: "Expires", value: formatDateTime(key.expiresAt) },
              ]} />
            }
          />
        );
      })}
    </OrganizationRosterList>
  );
}
