/**
 * PROTOTYPE (#1373) Variant A, "List page": stays in today's app shell, but
 * the page becomes a normal noma list page. One fact per column, Open as
 * the row's one button, the rest in a ⋮ menu, Create in a dialog.
 */
"use client";

import { useState } from "react";
import { BuildingsIcon, MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState, Notice, PageHeader, RowActionsMenu, StatusBadge } from "@/components/ui";
import { Skeleton } from "@/components/ui/loading-skeleton";
import {
  CreateOrganizationDialog,
  KeysDialog,
  filterRows,
  membersLabel,
  useApiAccessToggle,
  useKeysSaved,
  useOrgDirectory,
  type OrgRow,
} from "./shared";

export function VariantA() {
  const dir = useOrgDirectory();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const rows = filterRows(dir.rows, query);

  return (
    <div className="container-max page-shell">
      <PageHeader
        eyebrow="Platform"
        title="Organizations"
        actions={
          <Button type="button" variant="primary" onClick={() => setCreating(true)}>
            <PlusIcon size={16} weight="bold" /> New organization
          </Button>
        }
      />
      {dir.apiAccessFailed && (
        <Notice tone="error" action={<Button type="button" variant="weak" size="small" onClick={dir.retryApiAccess}>Retry</Button>}>
          API access could not be loaded. Retry to view or change it.
        </Notice>
      )}
      <div className="flex flex-col border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)]">
        <div className="flex items-center gap-8 border-b border-[var(--color-border-secondary)] p-12">
          <MagnifyingGlassIcon size={18} className="text-[var(--color-icon-secondary)]" />
          <input
            aria-label="Search organizations"
            placeholder="Search organizations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="body-medium h-40 w-full bg-transparent outline-none"
          />
        </div>
        {dir.isLoading ? (
          <div className="p-16"><Skeleton className="h-64 w-full" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<BuildingsIcon size={40} />} title={query ? "No organization matches" : "No organizations yet"} description={query ? "Try another name." : "Create the first organization to onboard an operator."} padding="md" />
        ) : (
          <table className="w-full border-collapse">
            <thead className="hidden md:table-header-group">
              <tr className="text-left">
                {["Organization", "Members", "Isometric keys", "API access", ""].map((h) => (
                  <th key={h} className="body-caption border-b border-[var(--color-border-secondary)] px-16 py-10 font-medium text-[var(--color-text-tertiary)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => <RowA key={row.id} row={row} entering={dir.entering} onOpen={() => dir.open(row)} />)}
            </tbody>
          </table>
        )}
      </div>
      <CreateOrganizationDialog isOpen={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function RowA({ row, entering, onOpen }: { row: OrgRow; entering: string | null; onOpen: () => void }) {
  const keys = useKeysSaved(row.id);
  const [keysOpen, setKeysOpen] = useState(false);
  const api = useApiAccessToggle(row);
  return (
    <tr className="flex flex-col gap-4 border-b border-[var(--color-border-secondary)] px-16 py-12 last:border-b-0 md:table-row md:p-0">
      <td className="md:px-16 md:py-12">
        <span className="body-medium font-medium">{row.name}</span>
        <span className="body-small block text-[var(--color-text-secondary)] md:hidden">
          {membersLabel(row.memberCount)} · Keys {keys ? "saved" : "missing"} · API {row.apiAccess ? "on" : "off"}
        </span>
      </td>
      <td className="body-small hidden text-[var(--color-text-secondary)] md:table-cell md:px-16">{membersLabel(row.memberCount)}</td>
      <td className="hidden md:table-cell md:px-16">
        {keys !== undefined && <StatusBadge status={keys ? "ready" : "draft"} label={keys ? "Saved" : "Missing"} />}
      </td>
      <td className="body-small hidden md:table-cell md:px-16">{row.apiAccess === undefined ? "Unknown" : row.apiAccess ? "On" : "Off"}</td>
      <td className="md:px-16">
        <div className="flex items-center justify-start gap-8 md:justify-end">
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
        </div>
        <KeysDialog org={row} isOpen={keysOpen} onClose={() => setKeysOpen(false)} />
        {api.dialog}
      </td>
    </tr>
  );
}
