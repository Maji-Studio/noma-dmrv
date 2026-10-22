/**
 * PROTOTYPE (#1373) Variant D, "Inside Settings": Organizations becomes a
 * real pane of the settings console, next to Diagnostics and Template
 * mapping, so the Platform group no longer links out. The page route
 * renders this inside SettingsConsole (see the page).
 */
"use client";

import { useState } from "react";
import { BuildingsIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState, RowActionsMenu, StatusBadge } from "@/components/ui";
import { Skeleton } from "@/components/ui/loading-skeleton";
import {
  CreateOrganizationDialog,
  KeysDialog,
  membersLabel,
  useApiAccessToggle,
  useKeysSaved,
  useOrgDirectory,
  type OrgRow,
} from "./shared";

export function VariantD() {
  const dir = useOrgDirectory();
  const [creating, setCreating] = useState(false);
  return (
    <div className="flex flex-col gap-16">
      <div>
        <Button type="button" variant="weak" size="small" onClick={() => setCreating(true)}>
          <PlusIcon size={14} weight="bold" /> New organization
        </Button>
      </div>
      {dir.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : dir.rows.length === 0 ? (
        <EmptyState icon={<BuildingsIcon size={40} />} title="No organizations yet" description="Create the first organization to onboard an operator." padding="md" />
      ) : (
        <ul className="flex flex-col border border-[var(--color-border-secondary)]">
          {dir.rows.map((row) => <RowD key={row.id} row={row} entering={dir.entering} onOpen={() => dir.open(row)} />)}
        </ul>
      )}
      <CreateOrganizationDialog isOpen={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function RowD({ row, entering, onOpen }: { row: OrgRow; entering: string | null; onOpen: () => void }) {
  const keys = useKeysSaved(row.id);
  const [keysOpen, setKeysOpen] = useState(false);
  const api = useApiAccessToggle(row);
  return (
    <li className="flex items-center gap-12 border-b border-[var(--color-border-secondary)] px-12 py-10 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <span className="body-medium truncate font-medium">{row.name}</span>
        <span className="flex flex-wrap items-center gap-8">
          <span className="body-small text-[var(--color-text-secondary)]">{membersLabel(row.memberCount)}</span>
          {keys !== undefined && <StatusBadge status={keys ? "ready" : "draft"} label={keys ? "Keys saved" : "No keys"} />}
          {row.apiAccess && <StatusBadge status="ready" label="API on" />}
        </span>
      </div>
      {row.current ? (
        <span className="body-small font-medium text-[var(--color-text-secondary)]">Current</span>
      ) : (
        <Button type="button" variant="weak" size="small" busy={entering === row.id} disabled={entering !== null && entering !== row.id} onClick={onOpen}>Open</Button>
      )}
      <RowActionsMenu
        label={`Actions for ${row.name}`}
        actions={[
          { label: keys ? "Replace Isometric keys" : "Add Isometric keys", onSelect: () => setKeysOpen(true) },
          { label: api.label, onSelect: api.request, disabled: row.apiAccess === undefined },
        ]}
      />
      <KeysDialog org={row} isOpen={keysOpen} onClose={() => setKeysOpen(false)} />
      {api.dialog}
    </li>
  );
}
